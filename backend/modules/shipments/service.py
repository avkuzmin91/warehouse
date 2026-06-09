from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_OP_MOVE_RETURN,
    SHIPMENT_OP_PACK,
    SHIPMENT_OP_PACK_CORRECTION,
    SHIPMENT_OP_RELOCATE,
    SHIPMENT_STATUS_AWAITING_TRIP,
    SHIPMENT_STATUS_LABELS,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_TRANSITION_ROLES,
    SHIPMENT_TRANSITIONS,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def next_doc_number(connection) -> str:
    """Генерирует следующий номер документа отгрузки.

    Использует MAX вместо COUNT, чтобы не давать дубликатов при пустых дырках.
    UNIQUE constraint на doc_number в baseline-миграции гарантирует атомарность.
    """
    row = connection.execute(
        """
        SELECT COALESCE(MAX(CAST(SUBSTR(doc_number, 5) AS INTEGER)), 0) AS max_n
        FROM shipment_docs
        WHERE doc_number LIKE 'SHP-%'
        """
    ).fetchone()
    n = (row["max_n"] if row else 0) + 1
    return f"SHP-{n:04d}"


def normalize_cargo_type(raw: str | None) -> str:
    s = str(raw or SHIPMENT_CARGO_GOOD).strip().lower()
    return s if s in (SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT) else SHIPMENT_CARGO_GOOD


def _check_stock_for_shipment(connection, doc_id: str) -> None:
    """Проверяет доступность остатков по месту для фактически отгружаемых строк."""
    from modules.balances.service import get_available_in_zone

    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchall()

    doc_row = connection.execute(
        "SELECT client_id, cargo_type FROM shipment_docs WHERE id = ?",
        (doc_id,),
    ).fetchone()

    cargo_type = normalize_cargo_type(doc_row["cargo_type"] if doc_row else None)

    for line in lines:
        shipped_qty = int(line["shipped_qty"] or 0)
        plan_qty = int(line["qty"] or 0)
        if shipped_qty > 0 and shipped_qty > plan_qty:
            raise HTTPException(
                status_code=400,
                detail=f"Отгруженное количество не должно превышать план для «{line['product_name']}»",
            )

    client_id = doc_row["client_id"] if doc_row else None

    for line in lines:
        shipped_qty = int(line["shipped_qty"] or 0)
        if shipped_qty <= 0:
            continue
        if not line["storage_zone_id"]:
            raise HTTPException(
                status_code=400,
                detail=f"Выберите место хранения для «{line['product_name']}»",
            )
        available = get_available_in_zone(
            connection,
            product_id=str(line["product_id"]),
            color_id=line["color_id"],
            size_id=line["size_id"],
            client_id=client_id,
            zone_id=line["storage_zone_id"],
            status=cargo_type,
        )
        if available < shipped_qty:
            zone_label = line["storage_zone_name"] or "Без места"
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Недостаточно товара в месте «{zone_label}» для «{line['product_name']}» "
                    f"(нужно {shipped_qty}, доступно {available})"
                ),
            )


def _check_duplicate_lines(connection, doc_id: str) -> None:
    """Проверяет отсутствие дублей товар+зона перед переходом статуса."""
    rows = connection.execute(
        """SELECT MIN(product_name) AS product_name,
                  MIN(storage_zone_name) AS storage_zone_name,
                  storage_zone_id,
                  COUNT(*) AS cnt
           FROM shipment_lines
           WHERE doc_id = ? AND is_deleted = 0
           GROUP BY product_id, color_id, size_id, storage_zone_id
           HAVING COUNT(*) > 1
           LIMIT 1""",
        (doc_id,),
    ).fetchone()
    if rows:
        zone_label = rows["storage_zone_name"] or ("без зоны" if rows["storage_zone_id"] is None else rows["storage_zone_id"])
        raise HTTPException(
            status_code=400,
            detail=f"Товар «{rows['product_name']}» добавлен дважды в зону «{zone_label}» — удалите дубль перед сохранением",
        )


def _line_pos_conds(line, prefix: str, client_col: str, client_id):
    """Условия позиции (product/color/size/client) для SQL по строке отгрузки."""
    conds = [f"{prefix}product_id = ?"]
    params: list = [line["product_id"]]
    for col, val in ((f"{prefix}color_id", line["color_id"]), (f"{prefix}size_id", line["size_id"]), (client_col, client_id)):
        if val is not None:
            conds.append(f"{col} = ?"); params.append(val)
        else:
            conds.append(f"{col} IS NULL")
    return " AND ".join(conds), params


def _move_one_to_packing(
    connection, line, *, packing_id, packing_name, client_id,
    qty: int, from_zone_id: str | None, user_id: str, comment: str,
) -> None:
    """Одна аллокация перемещения on_review → on_packing. Без commit.

    from_zone_id задан — берём только из этой зоны; None — FIFO по местам приёмки.
    """
    from modules.balances.service import get_available_in_zone, insert_inventory_move

    if qty <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество для перемещения")

    pos_sql, pos_params = _line_pos_conds(line, "l.", "d.client_id", client_id)
    src_conds = ["l.is_deleted = 0", "d.is_deleted = 0", "d.status = 'done'", pos_sql]
    src_params = list(pos_params)
    if from_zone_id:
        src_conds.append("l.storage_zone_id = ?"); src_params.append(from_zone_id)
    else:
        src_conds.append("l.storage_zone_id IS DISTINCT FROM ?"); src_params.append(packing_id)
    candidates = connection.execute(
        f"""SELECT l.storage_zone_id AS zone_id, MIN(l.storage_zone_name) AS zone_name,
                   MIN(d.actual_arrival_date) AS arr
            FROM receipt_lines l JOIN receipt_docs d ON d.id = l.doc_id
            WHERE {" AND ".join(src_conds)}
            GROUP BY l.storage_zone_id
            ORDER BY MIN(d.actual_arrival_date) IS NULL, MIN(d.actual_arrival_date)""",
        src_params,
    ).fetchall()

    plan = []
    total_avail = 0
    for r in candidates:
        avail = get_available_in_zone(
            connection, product_id=str(line["product_id"]), color_id=line["color_id"],
            size_id=line["size_id"], client_id=client_id, zone_id=r["zone_id"], status="on_review",
        )
        if avail > 0:
            plan.append((r["zone_id"], r["zone_name"], avail))
            total_avail += avail
    if total_avail < qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара «на проверке» для перемещения (доступно {total_avail}, нужно {qty})",
        )

    remaining = qty
    for zone_id, zone_name, avail in plan:
        if remaining <= 0:
            break
        take = min(avail, remaining)
        insert_inventory_move(
            connection,
            product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
            color_id=line["color_id"], color_name=line["color_name"],
            size_id=line["size_id"], size_name=line["size_name"],
            client_id=client_id, client_name=None,
            from_status="on_review", to_status="on_packing",
            from_zone_id=zone_id, from_zone_name=zone_name,
            to_zone_id=packing_id, to_zone_name=packing_name,
            qty=take, user_id=user_id, shipment_line_id=str(line["id"]),
            comment=comment,
        )
        remaining -= take


def move_line_to_packing(connection, doc_id: str, line_id: str, allocations, user_id: str) -> int:
    """Передача / подвоз on_review → «Зона упаковки» по списку аллокаций (зона, кол-во).

    Доступно в статусах «В плане» (первичная передача) и «На упаковке» (подвоз, чтобы
    добить план годным при браке). allocations — список объектов с .qty и .from_zone_id;
    from_zone_id=None означает FIFO по местам приёмки. Возвращает перемещённое количество.
    """
    from modules.balances.service import get_packing_zone

    items = [(int(a.qty), a.from_zone_id) for a in (allocations or [])]
    total = sum(qty for qty, _ in items)
    if total <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество для перемещения")

    doc = connection.execute(
        "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    status = str(doc["status"])
    if status not in (SHIPMENT_STATUS_PACKING, SHIPMENT_STATUS_ON_PACKING):
        raise HTTPException(status_code=400, detail="Перемещать в зону упаковки можно только «В плане» или «На упаковке»")

    line = connection.execute(
        "SELECT id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name "
        "FROM shipment_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
        (line_id, doc_id),
    ).fetchone()
    if not line:
        raise HTTPException(status_code=404, detail="Строка не найдена")

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc["client_id"]
    comment = ("Подвоз на упаковку" if status == SHIPMENT_STATUS_ON_PACKING else "Подготовка к упаковке")

    for qty, from_zone_id in items:
        _move_one_to_packing(
            connection, line,
            packing_id=packing_id, packing_name=packing_name, client_id=client_id,
            qty=qty, from_zone_id=from_zone_id, user_id=user_id, comment=f"{comment}: {qty} шт.",
        )
    connection.commit()
    return total


def return_line_from_packing(connection, doc_id: str, line_id: str, user_id: str, qty: int | None = None) -> int:
    """Откат передачи: возвращает пул on_packing строки обратно в исходные места (on_review).

    Журнал append-only, поэтому пишем компенсирующие обратные движения on_packing → on_review
    в те зоны, откуда товар приходил (из истории движений). В «На упаковке» возвращается только
    нерешённый пул (упакованное не трогаем). qty=None — вернуть весь доступный пул.
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move

    doc = connection.execute(
        "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc["status"]) not in (SHIPMENT_STATUS_PACKING, SHIPMENT_STATUS_ON_PACKING):
        raise HTTPException(status_code=400, detail="Откат передачи доступен только «В плане» или «На упаковке»")

    line = connection.execute(
        "SELECT id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name "
        "FROM shipment_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
        (line_id, doc_id),
    ).fetchone()
    if not line:
        raise HTTPException(status_code=404, detail="Строка не найдена")

    pool = line_on_packing_qty(connection, line_id)
    if pool <= 0:
        raise HTTPException(status_code=400, detail="Нечего возвращать — на упаковке нет нерешённого товара")
    target = pool if qty is None else min(int(qty), pool)
    if target <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество для возврата")

    # Net по исходной зоне = передано из неё − уже возвращённое обратно в неё.
    sources = connection.execute(
        """SELECT zone_id, MIN(zone_name) AS zone_name, SUM(net) AS net FROM (
               SELECT from_zone_id AS zone_id, from_zone_name AS zone_name, qty AS net
               FROM zone_relocations
               WHERE shipment_line_id = ? AND from_status = 'on_review' AND to_status = 'on_packing'
               UNION ALL
               SELECT to_zone_id AS zone_id, to_zone_name AS zone_name, -qty AS net
               FROM zone_relocations
               WHERE shipment_line_id = ? AND from_status = 'on_packing' AND to_status = 'on_review'
           ) t
           GROUP BY zone_id HAVING SUM(net) > 0
           ORDER BY SUM(net) DESC""",
        (line_id, line_id),
    ).fetchall()

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc["client_id"]
    remaining = target
    for src in sources:
        if remaining <= 0:
            break
        take = min(int(src["net"]), remaining)
        if take <= 0:
            continue
        insert_inventory_move(
            connection,
            product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
            color_id=line["color_id"], color_name=line["color_name"],
            size_id=line["size_id"], size_name=line["size_name"],
            client_id=client_id, client_name=None,
            from_status="on_packing", to_status="on_review",
            from_zone_id=packing_id, from_zone_name=packing_name,
            to_zone_id=src["zone_id"], to_zone_name=src["zone_name"],
            qty=take, user_id=user_id, shipment_line_id=line_id,
            comment=f"Откат передачи: {take} шт → {src['zone_name'] or 'без места'}",
        )
        remaining -= take

    returned = target - remaining
    label = line["product_sku"] or line["product_name"]
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_MOVE_RETURN,
         f"Откат передачи на упаковку: {returned} шт — {label}", _now(), user_id),
    )
    connection.commit()
    return returned


def line_packed_breakdown(connection, line_id: str) -> dict:
    """Факт упаковки строки из журнала: {'good': N, 'defect': M} по shipment_line_id.

    net(kind) = Σ(on_review→kind) − Σ(kind→on_review).
    """
    row = connection.execute(
        """SELECT
              COALESCE(SUM(CASE WHEN to_status='good'   THEN qty WHEN from_status='good'   THEN -qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN to_status='defect' THEN qty WHEN from_status='defect' THEN -qty ELSE 0 END), 0) AS defect
           FROM zone_relocations WHERE shipment_line_id = ?""",
        (line_id,),
    ).fetchone()
    return {"good": int(row["good"] or 0), "defect": int(row["defect"] or 0)}


def line_on_packing_qty(connection, line_id: str) -> int:
    """Остаток конкретной строки в статусе «На упаковке» по журналу движений."""
    row = connection.execute(
        """SELECT COALESCE(SUM(CASE
              WHEN to_status = ? THEN qty
              WHEN from_status = ? THEN -qty
              ELSE 0
           END), 0) AS qty
           FROM zone_relocations
           WHERE shipment_line_id = ?""",
        (SHIPMENT_STATUS_ON_PACKING, SHIPMENT_STATUS_ON_PACKING, line_id),
    ).fetchone()
    return int(row["qty"] or 0)


def _validate_packed_date(value: str) -> str:
    """Бизнес-дата упаковки в формате YYYY-MM-DD. 400 при некорректной."""
    try:
        date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Укажите корректную дату упаковки")
    return str(value)


def record_packing(
    connection, doc_id: str, line_id: str,
    good_delta: int, defect_delta: int, packed_date: str, user_id: str,
) -> dict:
    """QC при упаковке: вносит годный и/или брак одной записью с датой упаковки.

    Обе дельты неотрицательны (коррекция — через reverse_packing_entry). good+defect
    одного «Записать» получают общий pack_entry_id для группировки/отмены.
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move

    good_delta = int(good_delta or 0)
    defect_delta = int(defect_delta or 0)
    if good_delta < 0 or defect_delta < 0:
        raise HTTPException(status_code=400, detail="Количество не может быть отрицательным")
    if good_delta == 0 and defect_delta == 0:
        raise HTTPException(status_code=400, detail="Укажите количество годного или брака")
    packed_date = _validate_packed_date(packed_date)

    doc_row = connection.execute(
        "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc_row:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc_row["status"]) != SHIPMENT_STATUS_ON_PACKING:
        raise HTTPException(status_code=400, detail="Упаковку можно вносить только в статусе «На упаковке»")

    line = connection.execute(
        "SELECT id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name, qty "
        "FROM shipment_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
        (line_id, doc_id),
    ).fetchone()
    if not line:
        raise HTTPException(status_code=404, detail="Строка не найдена")

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc_row["client_id"]
    plan_qty = int(line["qty"] or 0)
    packed = line_packed_breakdown(connection, line_id)

    # Годного — не больше плана. Брак планом не ограничен (только наличием на столе):
    # так упаковщик добивает план годным при наличии брака.
    if packed["good"] + good_delta > plan_qty:
        raise HTTPException(status_code=400, detail=f"Годного упаковано не должно превышать план ({plan_qty} шт.)")
    add = good_delta + defect_delta
    avail = line_on_packing_qty(connection, line_id)
    if avail < add:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно товара на упаковке (доступно {avail}, нужно {add}) — переместите в зону упаковки",
        )

    pack_entry_id = str(uuid4())
    label = line["product_sku"] or line["product_name"]
    for kind, delta in (("good", good_delta), ("defect", defect_delta)):
        if delta <= 0:
            continue
        kind_ru = "годный" if kind == "good" else "брак"
        insert_inventory_move(
            connection,
            product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
            color_id=line["color_id"], color_name=line["color_name"],
            size_id=line["size_id"], size_name=line["size_name"],
            client_id=client_id, client_name=None,
            from_status="on_packing", to_status=kind,
            from_zone_id=packing_id, from_zone_name=packing_name,
            to_zone_id=packing_id, to_zone_name=packing_name,
            qty=delta, user_id=user_id, shipment_line_id=line_id,
            comment=f"Упаковка ({kind_ru}): +{delta} шт.",
            packed_date=packed_date, pack_entry_id=pack_entry_id,
        )
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_PACK,
             f"Упаковка {kind_ru} ({packed_date}): +{delta} шт. — {label}", _now(), user_id),
        )
    connection.commit()
    return line_packed_breakdown(connection, line_id)


def list_packing_entries(connection, line_id: str) -> list[dict]:
    """История записей упаковки строки: одна строка истории на pack_entry_id.

    Отдаёт только первичные записи (reverses_id IS NULL); reversed=true, если по записи
    есть компенсация. Строки-компенсации в список не попадают.
    """
    rows = connection.execute(
        """SELECT zr.pack_entry_id AS id,
              MIN(zr.packed_date) AS packed_date,
              MIN(zr.created_at) AS created_at,
              MIN(zr.created_by) AS created_by,
              MIN(u.email) AS created_by_email,
              COALESCE(SUM(CASE WHEN zr.to_status='good'   THEN zr.qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN zr.to_status='defect' THEN zr.qty ELSE 0 END), 0) AS defect
           FROM zone_relocations zr
           LEFT JOIN users u ON u.id = zr.created_by
           WHERE zr.shipment_line_id = ? AND zr.pack_entry_id IS NOT NULL AND zr.reverses_id IS NULL
           GROUP BY zr.pack_entry_id
           ORDER BY MIN(zr.created_at) DESC""",
        (line_id,),
    ).fetchall()
    rev_rows = connection.execute(
        "SELECT DISTINCT reverses_id FROM zone_relocations "
        "WHERE shipment_line_id = ? AND reverses_id IS NOT NULL",
        (line_id,),
    ).fetchall()
    reversed_ids = {str(r["reverses_id"]) for r in rev_rows}
    return [
        {
            "id": str(r["id"]),
            "packed_date": r["packed_date"],
            "good": int(r["good"] or 0),
            "defect": int(r["defect"] or 0),
            "created_at": str(r["created_at"]),
            "created_by": r["created_by"],
            "created_by_email": r["created_by_email"],
            "reversed": str(r["id"]) in reversed_ids,
        }
        for r in rows
    ]


def reverse_packing_entry(connection, doc_id: str, line_id: str, entry_id: str, user_id: str) -> dict:
    """Отмена ошибочной записи упаковки: пишет обратные движения (append-only).

    Чистый откат — план/пул не валидируем. Повторная отмена запрещена.
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move

    doc_row = connection.execute(
        "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc_row:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc_row["status"]) != SHIPMENT_STATUS_ON_PACKING:
        raise HTTPException(status_code=400, detail="Отменять записи упаковки можно только в статусе «На упаковке»")

    already = connection.execute(
        "SELECT 1 FROM zone_relocations WHERE reverses_id = ? AND shipment_line_id = ? LIMIT 1",
        (entry_id, line_id),
    ).fetchone()
    if already:
        raise HTTPException(status_code=400, detail="Запись уже отменена")

    rows = connection.execute(
        "SELECT * FROM zone_relocations "
        "WHERE pack_entry_id = ? AND shipment_line_id = ? AND reverses_id IS NULL",
        (entry_id, line_id),
    ).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="Запись упаковки не найдена")

    packing_id, packing_name = get_packing_zone(connection)
    for r in rows:
        kind = str(r["to_status"])  # good | defect (исходное направление on_packing→kind)
        kind_ru = "годный" if kind == "good" else "брак"
        label = r["product_sku"] or r["product_name"]
        qty = int(r["qty"] or 0)
        insert_inventory_move(
            connection,
            product_id=str(r["product_id"]), product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=r["client_id"], client_name=r["client_name"],
            from_status=str(r["to_status"]), to_status=str(r["from_status"]),
            from_zone_id=packing_id, from_zone_name=packing_name,
            to_zone_id=packing_id, to_zone_name=packing_name,
            qty=qty, user_id=user_id, shipment_line_id=line_id,
            comment="Отмена записи упаковки",
            packed_date=r["packed_date"], pack_entry_id=str(uuid4()), reverses_id=entry_id,
        )
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_PACK_CORRECTION,
             f"Отмена упаковки {kind_ru}: −{qty} шт. — {label}", _now(), user_id),
        )
    connection.commit()
    return line_packed_breakdown(connection, line_id)


def _doc_moved_to_packing_qty(connection, doc_id: str) -> int:
    """Сколько по документу всего передано в зону упаковки (to_status='on_packing')."""
    row = connection.execute(
        """SELECT COALESCE(SUM(zr.qty), 0) AS moved
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0 AND zr.to_status = 'on_packing'""",
        (doc_id,),
    ).fetchone()
    return int(row["moved"] or 0)


def _doc_packed_qty(connection, doc_id: str) -> dict:
    """Упаковано по документу: {'good': N, 'defect': M} (net по журналу)."""
    row = connection.execute(
        """SELECT
              COALESCE(SUM(CASE WHEN zr.to_status='good'   THEN zr.qty WHEN zr.from_status='good'   THEN -zr.qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN zr.to_status='defect' THEN zr.qty WHEN zr.from_status='defect' THEN -zr.qty ELSE 0 END), 0) AS defect
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0""",
        (doc_id,),
    ).fetchone()
    return {"good": int(row["good"] or 0), "defect": int(row["defect"] or 0)}


def finish_relocation(connection, doc_id: str, line_inputs, user_id: str) -> str:
    """«Готово к рейсу»: кладовщик раскидывает упакованный годный/брак по местам хранения.

    Из «Зоны упаковки» перемещает good→good и defect→defect в указанные места (одну
    строку можно разложить в несколько мест). Не списывает — товар остаётся в остатках
    на новых местах. Гейт: по каждой строке суммы аллокаций должны точно покрыть весь
    упакованный годный и весь брак. Переводит relocating → awaiting_trip.
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move

    doc = connection.execute(
        "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc["status"]) != SHIPMENT_STATUS_RELOCATING:
        raise HTTPException(status_code=400, detail="Разложить по местам можно только в статусе «Перемещение»")

    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0", (doc_id,)
    ).fetchall()
    by_id = {str(l["id"]): l for l in lines}
    inputs_by_id = {str(li.line_id): li for li in (line_inputs or [])}

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc["client_id"]

    def _alloc_zone(a) -> tuple[str, str | None, int]:
        zone_id = (a.zone_id or "").strip()
        qty = int(a.qty or 0)
        if not zone_id:
            raise HTTPException(status_code=400, detail="Выберите место для каждой строки перемещения")
        if qty <= 0:
            raise HTTPException(status_code=400, detail="Укажите количество больше нуля")
        return zone_id, (a.zone_name or None), qty

    total_moved = 0
    for line_id, line in by_id.items():
        packed = line_packed_breakdown(connection, line_id)
        good, defect = packed["good"], packed["defect"]
        li = inputs_by_id.get(line_id)
        good_allocs = [_alloc_zone(a) for a in (li.good if li else [])]
        defect_allocs = [_alloc_zone(a) for a in (li.defect if li else [])]
        label = line["product_sku"] or line["product_name"]

        if sum(q for *_, q in good_allocs) != good:
            raise HTTPException(
                status_code=400,
                detail=f"Разложите весь годный товар по местам для «{line['product_name']}» (нужно {good} шт.)",
            )
        if sum(q for *_, q in defect_allocs) != defect:
            raise HTTPException(
                status_code=400,
                detail=f"Разложите весь брак по местам для «{line['product_name']}» (нужно {defect} шт.)",
            )

        for kind, allocs in (("good", good_allocs), ("defect", defect_allocs)):
            kind_ru = "годный" if kind == "good" else "брак"
            for zone_id, zone_name, qty in allocs:
                insert_inventory_move(
                    connection,
                    product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                    color_id=line["color_id"], color_name=line["color_name"],
                    size_id=line["size_id"], size_name=line["size_name"],
                    client_id=client_id, client_name=None,
                    from_status=kind, to_status=kind,
                    from_zone_id=packing_id, from_zone_name=packing_name,
                    to_zone_id=zone_id, to_zone_name=zone_name,
                    qty=qty, user_id=user_id, shipment_line_id=line_id,
                    comment=f"Перемещение к рейсу ({kind_ru}): {qty} шт → {zone_name or 'без места'} — {label}",
                )
                total_moved += qty

        # Нерешённый пул on_packing (подвезли, но не упаковали) возвращаем в on_review,
        # чтобы товар не завис на упаковочном столе и баланс не утекал.
        leftover = line_on_packing_qty(connection, line_id)
        if leftover > 0:
            insert_inventory_move(
                connection,
                product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                color_id=line["color_id"], color_name=line["color_name"],
                size_id=line["size_id"], size_name=line["size_name"],
                client_id=client_id, client_name=None,
                from_status="on_packing", to_status="on_review",
                from_zone_id=packing_id, from_zone_name=packing_name,
                to_zone_id=packing_id, to_zone_name=packing_name,
                qty=leftover, user_id=user_id, shipment_line_id=line_id,
                comment=f"Возврат на проверку нерешённого пула: {leftover} шт.",
            )

    if total_moved <= 0:
        raise HTTPException(status_code=400, detail="Нет упакованного товара для перемещения")

    now = _now()
    connection.execute(
        "UPDATE shipment_docs SET status=?, updated_at=? WHERE id=?",
        (SHIPMENT_STATUS_AWAITING_TRIP, now, doc_id),
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_RELOCATE,
         f"Разложено по местам: {total_moved} шт. → Ожидает рейс", now, user_id),
    )
    connection.commit()
    return SHIPMENT_STATUS_AWAITING_TRIP


def advance_shipment(connection, doc_id: str, user_id: str, user_role: str) -> str:
    """Переводит документ на следующий статус с ролевым гейтом и проверками фазы.

    draft → packing (Запланировать) · packing → on_packing (Передать на упаковку) ·
    on_packing → relocating (Передать кладовщику). relocating → awaiting_trip («Готово
    к рейсу») делает отдельный эндпоинт finish_relocation, здесь его нет.
    """
    row = connection.execute(
        "SELECT status, comment FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")

    current = str(row["status"])
    next_status = SHIPMENT_TRANSITIONS.get(current)
    if not next_status:
        raise HTTPException(
            status_code=400,
            detail=f"Нельзя продвинуть из статуса «{SHIPMENT_STATUS_LABELS.get(current, current)}»",
        )

    if user_role not in SHIPMENT_TRANSITION_ROLES.get(next_status, frozenset()):
        raise HTTPException(status_code=403, detail="Недостаточно прав для этого перехода")

    if next_status == SHIPMENT_STATUS_PACKING:
        if not str(row["comment"] or "").strip():
            raise HTTPException(status_code=400, detail="Заполните техническое задание")
        _check_duplicate_lines(connection, doc_id)
    elif next_status == SHIPMENT_STATUS_ON_PACKING:
        if _doc_moved_to_packing_qty(connection, doc_id) <= 0:
            raise HTTPException(status_code=400, detail="Передайте на упаковку хотя бы часть товара")
    elif next_status == SHIPMENT_STATUS_RELOCATING:
        packed = _doc_packed_qty(connection, doc_id)
        if packed["good"] + packed["defect"] <= 0:
            raise HTTPException(status_code=400, detail="Упакуйте хотя бы часть товара перед передачей кладовщику")

    now = _now()
    connection.execute(
        "UPDATE shipment_docs SET status=?, updated_at=? WHERE id=?",
        (next_status, now, doc_id),
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, "advance", f"{current} → {next_status}", now, user_id),
    )
    connection.commit()
    return next_status
