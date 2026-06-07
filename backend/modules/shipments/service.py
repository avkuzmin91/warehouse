from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_OP_PACK,
    SHIPMENT_OP_PACK_CORRECTION,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_SHIPPED,
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
    """Проверяет доступность остатков по месту для всех строк документа (good и defect).

    Вызывается перед переходом packing → shipped. Требует указанное место и
    бросает HTTPException(400) без места / HTTPException(409) при нехватке остатка —
    чтобы отгрузка не уводила остаток места в минус.
    """
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
        if shipped_qty <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Укажите отгруженное количество больше 0 для «{line['product_name']}»",
            )
        if shipped_qty > plan_qty:
            raise HTTPException(
                status_code=400,
                detail=f"Отгруженное количество не должно превышать план для «{line['product_name']}»",
            )

    client_id = doc_row["client_id"] if doc_row else None

    for line in lines:
        shipped_qty = int(line["shipped_qty"] or 0)
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


def move_line_to_packing(connection, doc_id: str, line_id: str, qty: int, from_zone_id: str | None, user_id: str) -> int:
    """Подготовка к упаковке: кладовщик перемещает on_review строки в «Зону упаковки».

    Источник по умолчанию — FIFO (старейшая приёмка первой). Без наличия позиции в зоне
    упаковки упаковщик паковать не сможет. Возвращает перемещённое количество.
    """
    from modules.balances.service import get_packing_zone, get_available_in_zone, insert_inventory_move

    if qty <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество для перемещения")

    doc = connection.execute(
        "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc["status"]) != SHIPMENT_STATUS_PACKING:
        raise HTTPException(status_code=400, detail="Перемещать в зону упаковки можно только в статусе «В плане»")

    line = connection.execute(
        "SELECT product_id, product_name, product_sku, color_id, color_name, size_id, size_name "
        "FROM shipment_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
        (line_id, doc_id),
    ).fetchone()
    if not line:
        raise HTTPException(status_code=404, detail="Строка не найдена")

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc["client_id"]

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
            from_status="on_review", to_status="on_review",
            from_zone_id=zone_id, from_zone_name=zone_name,
            to_zone_id=packing_id, to_zone_name=packing_name,
            qty=take, user_id=user_id, shipment_line_id=line_id,
            comment=f"Подготовка к упаковке: {take} шт.",
        )
        remaining -= take
    connection.commit()
    return qty


def line_packed_breakdown(connection, line_id: str) -> dict:
    """Факт упаковки строки из журнала: {'good': N, 'defect': M} по shipment_line_id.

    net(kind) = Σ(on_review→kind) − Σ(kind→on_review).
    """
    row = connection.execute(
        """SELECT
              COALESCE(SUM(CASE WHEN from_status='on_review' AND to_status='good'   THEN qty
                                WHEN from_status='good'   AND to_status='on_review' THEN -qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN from_status='on_review' AND to_status='defect' THEN qty
                                WHEN from_status='defect' AND to_status='on_review' THEN -qty ELSE 0 END), 0) AS defect
           FROM zone_relocations WHERE shipment_line_id = ?""",
        (line_id,),
    ).fetchone()
    return {"good": int(row["good"] or 0), "defect": int(row["defect"] or 0)}


def pack_shipment_line(connection, doc_id: str, line_id: str, delta: int, kind: str, user_id: str) -> dict:
    """QC при упаковке: делит товар на годный/брак конвертацией в «Зоне упаковки».

    Статус on_review→good|defect (место не меняется). delta>0 — упаковать, delta<0 —
    коррекция (вернуть в on_review). Возвращает {'good','defect'} по строке.
    """
    from modules.balances.service import get_packing_zone, get_available_in_zone, insert_inventory_move

    if kind not in ("good", "defect"):
        raise HTTPException(status_code=400, detail="Тип должен быть good или defect")
    if delta == 0:
        raise HTTPException(status_code=400, detail="Укажите количество упаковки")

    doc_row = connection.execute(
        "SELECT status, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc_row:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc_row["status"]) != SHIPMENT_STATUS_PACKING:
        raise HTTPException(status_code=400, detail="Упаковку можно вносить только в статусе «В плане»")

    line = connection.execute(
        "SELECT product_id, product_name, product_sku, color_id, color_name, size_id, size_name, qty "
        "FROM shipment_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
        (line_id, doc_id),
    ).fetchone()
    if not line:
        raise HTTPException(status_code=404, detail="Строка не найдена")

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc_row["client_id"]
    plan_qty = int(line["qty"] or 0)
    packed = line_packed_breakdown(connection, line_id)

    if delta > 0:
        if packed["good"] + packed["defect"] + delta > plan_qty:
            raise HTTPException(status_code=400, detail=f"Упаковано не должно превышать план ({plan_qty} шт.)")
        avail = get_available_in_zone(
            connection, product_id=str(line["product_id"]), color_id=line["color_id"],
            size_id=line["size_id"], client_id=client_id, zone_id=packing_id, status="on_review",
        )
        if avail < delta:
            raise HTTPException(
                status_code=400,
                detail=f"Недостаточно товара «на проверке» в зоне упаковки (доступно {avail}, нужно {delta})",
            )
        from_status, to_status = "on_review", kind
        move_qty = delta
    else:
        move_qty = -delta
        if packed[kind] < move_qty:
            raise HTTPException(status_code=400, detail=f"Нельзя списать больше упакованного ({packed[kind]} шт.)")
        from_status, to_status = kind, "on_review"

    insert_inventory_move(
        connection,
        product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
        color_id=line["color_id"], color_name=line["color_name"],
        size_id=line["size_id"], size_name=line["size_name"],
        client_id=client_id, client_name=None,
        from_status=from_status, to_status=to_status,
        from_zone_id=packing_id, from_zone_name=packing_name,
        to_zone_id=packing_id, to_zone_name=packing_name,
        qty=move_qty, user_id=user_id, shipment_line_id=line_id,
        comment=f"Упаковка ({'годный' if kind == 'good' else 'брак'}): {'+' if delta > 0 else '−'}{move_qty} шт.",
    )
    op_type = SHIPMENT_OP_PACK if delta > 0 else SHIPMENT_OP_PACK_CORRECTION
    label = line["product_sku"] or line["product_name"]
    kind_ru = "годный" if kind == "good" else "брак"
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, op_type,
         f"Упаковка {kind_ru}: {'+' if delta > 0 else '−'}{move_qty} шт. — {label}", _now(), user_id),
    )
    connection.commit()
    return line_packed_breakdown(connection, line_id)


def advance_shipment(connection, doc_id: str, user_id: str) -> str:
    """Переводит документ на следующий статус. При переходе packing → shipped проверяет остатки."""
    row = connection.execute(
        "SELECT status FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")

    current = str(row["status"])
    next_status = SHIPMENT_TRANSITIONS.get(current)
    if not next_status:
        raise HTTPException(status_code=400, detail=f"Нельзя продвинуть из статуса «{current}»")

    _check_duplicate_lines(connection, doc_id)
    if next_status == SHIPMENT_STATUS_SHIPPED:
        _check_stock_for_shipment(connection, doc_id)

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
