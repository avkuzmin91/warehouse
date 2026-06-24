from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    INV_OP_PACKED,
    INV_OP_PACKING,
    INV_OP_READY,
    INV_OP_STORAGE,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    RECEIPT_STATUS_DONE,
    RECEIPT_STATUS_PARTIALLY_RECEIVED,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_OP_MOVE_RETURN,
    SHIPMENT_OP_PACK,
    SHIPMENT_OP_PACK_CORRECTION,
    SHIPMENT_OP_RELOCATE,
    SHIPMENT_OP_RETURN_TO_PACKING,
    SHIPMENT_STATUS_ASSIGNED,
    SHIPMENT_STATUS_LABELS,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_PACKED,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_TRANSITION_ROLES,
    SHIPMENT_TRANSITION_ROLES_DEFECT,
    SHIPMENT_TRANSITIONS,
    SHIPMENT_TRANSITIONS_DEFECT,
)
from dbconn import like_substring_param


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


def _check_duplicate_lines(connection, doc_id: str) -> None:
    """Проверяет отсутствие дублей товар+зона+магазин перед переходом статуса."""
    rows = connection.execute(
        """SELECT MIN(product_name) AS product_name,
                  MIN(storage_zone_name) AS storage_zone_name,
                  storage_zone_id,
                  MIN(store_name) AS store_name,
                  store_id,
                  COUNT(*) AS cnt
           FROM shipment_lines
           WHERE doc_id = ? AND is_deleted = 0
           GROUP BY product_id, color_id, size_id, storage_zone_id, store_id
           HAVING COUNT(*) > 1
           LIMIT 1""",
        (doc_id,),
    ).fetchone()
    if rows:
        zone_label = rows["storage_zone_name"] or ("без зоны" if rows["storage_zone_id"] is None else rows["storage_zone_id"])
        store_suffix = ""
        if rows["store_id"] is not None:
            store_label = rows["store_name"] or rows["store_id"]
            store_suffix = f", магазин «{store_label}»"
        raise HTTPException(
            status_code=400,
            detail=f"Товар «{rows['product_name']}» добавлен дважды в зону «{zone_label}»{store_suffix} — удалите дубль перед сохранением",
        )


def _check_lines_have_sku(connection, doc_id: str) -> None:
    """Гейт перевода в план: у каждого товара отгрузки должен быть присвоен SKU.

    Товар «ожидает SKU» (sku_pending) планировать нельзя — артикул нужен для упаковки,
    маркировки и счетов. Источник истины — `products.sku_pending`: копия `product_sku`
    в строке отгрузки — снимок на момент добавления и не обновляется при дозаполнении.
    """
    rows = connection.execute(
        """SELECT DISTINCT l.product_name
           FROM shipment_lines l
           JOIN products p ON p.id = l.product_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0
             AND COALESCE(p.sku_pending, 0) = 1
           ORDER BY l.product_name""",
        (doc_id,),
    ).fetchall()
    if rows:
        names = ", ".join(f"«{r['product_name']}»" for r in rows)
        raise HTTPException(
            status_code=400,
            detail=f"Укажите SKU для товаров без артикула перед планированием: {names}",
        )


def _check_lines_covered_by_stock(connection, doc_id: str, client_id) -> None:
    """Гейт плана: каждая позиция должна быть покрыта свободным годным остатком
    «На хранении». Иначе товар ещё в пути — документ держим в черновике. Тот же
    гейт применяется при добавлении/правке строк в статусе «В плане» — иначе можно
    дописать в план товар, которого ещё нет на складе.

    Спрос агрегируем по варианту (product/color/size): одна позиция может быть в
    нескольких строках (разные магазины), а остаток у неё общий. Уже переданное на
    упаковку по этому документу ушло из свободного склада, но за документом
    закреплено — поэтому добавляем его обратно к доступному (иначе правка состава
    после первой передачи кладовщику ложно отклоняется)."""
    from modules.balances.service import get_available_total

    rows = connection.execute(
        """SELECT product_id, color_id, size_id,
                  MIN(product_name) AS product_name, MIN(product_sku) AS product_sku,
                  MIN(color_name) AS color_name, MIN(size_name) AS size_name,
                  SUM(qty) AS demand
           FROM shipment_lines
           WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0
           GROUP BY product_id, color_id, size_id""",
        (doc_id,),
    ).fetchall()

    on_packing_rows = connection.execute(
        """SELECT sl.product_id, sl.color_id, sl.size_id,
                  COALESCE(SUM(CASE
                     WHEN zr.to_op = 'packing'   AND zr.to_quality = 'good'   THEN zr.qty
                     WHEN zr.from_op = 'packing' AND zr.from_quality = 'good' THEN -zr.qty
                     ELSE 0 END), 0) AS on_packing
           FROM zone_relocations zr
           JOIN shipment_lines sl ON sl.id = zr.shipment_line_id
           WHERE sl.doc_id = ? AND COALESCE(sl.is_deleted, 0) = 0
           GROUP BY sl.product_id, sl.color_id, sl.size_id""",
        (doc_id,),
    ).fetchall()
    on_packing = {
        (str(r["product_id"]), r["color_id"], r["size_id"]): int(r["on_packing"] or 0)
        for r in on_packing_rows
    }

    short: list[str] = []
    for r in rows:
        available = get_available_total(
            connection,
            product_id=str(r["product_id"]),
            color_id=r["color_id"],
            size_id=r["size_id"],
            client_id=client_id,
            op=INV_OP_STORAGE,
            quality=INV_Q_GOOD,
        )
        committed = on_packing.get((str(r["product_id"]), r["color_id"], r["size_id"]), 0)
        supply = available + committed
        demand = int(r["demand"] or 0)
        if demand > supply:
            label = " · ".join(x for x in [r["product_sku"], r["color_name"], r["size_name"]] if x) or r["product_name"]
            short.append(f"«{label}»: нужно {demand}, на складе {supply}")
    if short:
        raise HTTPException(
            status_code=400,
            detail="Часть товара ещё не на остатках (в пути) — дождитесь прихода. " + "; ".join(short),
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
    """Одна аллокация передачи на упаковку: (storage, good) → (packing, good). Без commit.

    from_zone_id задан — берём только из этой зоны; None — FIFO по местам приёмки.
    """
    from modules.balances.service import get_available_in_zone, insert_inventory_move

    if qty <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество для перемещения")

    pos_sql, pos_params = _line_pos_conds(line, "l.", "d.client_id", client_id)
    # Источник зон — поступления с проведённым приходом: done (принято полностью) и
    # partially_received (часть уже лежит в storage). Якорь совпадает с остатками
    # (_ANCHOR_STATUSES в balances): товар частично приехавшего поступления уже на
    # складе и доступен к передаче на упаковку.
    anchor_sql = f"d.status IN ('{RECEIPT_STATUS_DONE}', '{RECEIPT_STATUS_PARTIALLY_RECEIVED}')"
    src_conds = ["l.is_deleted = 0", "d.is_deleted = 0", anchor_sql, pos_sql]
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
            size_id=line["size_id"], client_id=client_id, zone_id=r["zone_id"],
            op=INV_OP_STORAGE, quality=INV_Q_GOOD,
        )
        if avail > 0:
            plan.append((r["zone_id"], r["zone_name"], avail))
            total_avail += avail
    if total_avail < qty:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно годного товара на хранении для перемещения (доступно {total_avail}, нужно {qty})",
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
            from_op=INV_OP_STORAGE, to_op=INV_OP_PACKING,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
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
    """Откат передачи: возвращает пул «На упаковке» обратно на хранение в исходные места.

    Журнал append-only, поэтому пишем компенсирующие обратные движения
    (packing, good) → (storage, good) в те зоны, откуда товар приходил (из истории
    движений). Возвращается только нерешённый пул (упакованное не трогаем).
    qty=None — вернуть весь доступный пул.
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
               WHERE shipment_line_id = ? AND from_op = 'storage' AND to_op = 'packing'
                 AND from_quality = 'good' AND to_quality = 'good'
               UNION ALL
               SELECT to_zone_id AS zone_id, to_zone_name AS zone_name, -qty AS net
               FROM zone_relocations
               WHERE shipment_line_id = ? AND from_op = 'packing' AND to_op = 'storage'
                 AND from_quality = 'good' AND to_quality = 'good'
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
            from_op=INV_OP_PACKING, to_op=INV_OP_STORAGE,
            from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
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


# Net упаковки по журналу (две оси):
#   good  = конвертации в packed (упаковано) минус откаты packed→packing;
#           перевод packed→ready (готовность к отгрузке при «Готово к рейсу») и
#           списание ready→shipped факт упаковки не меняют — число «упаковано» держится;
#   defect = конвертации качества good→defect минус обратные. Раскладка брака
#           (packed→storage с тем же качеством) и списание факт не меняют.
_PACKED_NET_SQL = """
    COALESCE(SUM(CASE WHEN {p}to_op='packed'   AND {p}to_quality='good'   AND COALESCE({p}from_op,'') NOT IN ('packed','ready') THEN {p}qty
                      WHEN {p}from_op='packed' AND {p}from_quality='good' AND {p}to_op='packing'                              THEN -{p}qty
                      ELSE 0 END), 0) AS good,
    COALESCE(SUM(CASE WHEN {p}to_quality='defect'   AND COALESCE({p}from_quality,'')<>'defect' THEN {p}qty
                      WHEN {p}from_quality='defect' AND COALESCE({p}to_quality,'')<>'defect'   THEN -{p}qty
                      ELSE 0 END), 0) AS defect
"""


def line_packed_breakdown(connection, line_id: str) -> dict:
    """Факт упаковки строки из журнала: {'good': N, 'defect': M} по shipment_line_id."""
    row = connection.execute(
        f"""SELECT {_PACKED_NET_SQL.format(p='')}
           FROM zone_relocations WHERE shipment_line_id = ?""",
        (line_id,),
    ).fetchone()
    return {"good": int(row["good"] or 0), "defect": int(row["defect"] or 0)}


def line_on_packing_qty(connection, line_id: str) -> int:
    """Нерешённый пул строки на упаковочном столе: net (packing, good) по журналу."""
    row = connection.execute(
        """SELECT COALESCE(SUM(CASE
              WHEN to_op = 'packing'   AND to_quality = 'good'   THEN qty
              WHEN from_op = 'packing' AND from_quality = 'good' THEN -qty
              ELSE 0
           END), 0) AS qty
           FROM zone_relocations
           WHERE shipment_line_id = ?""",
        (line_id,),
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
    # И годный, и найденный брак уходят в «Упаковано» (packing,good → packed). Это ещё
    # НЕ «Готов к отгрузке»: годное переведёт в ready только «Готово к рейсу»
    # (finish_relocation), брак там же вернётся на хранение.
    for kind, delta, to_op in (
        (INV_Q_GOOD, good_delta, INV_OP_PACKED),
        (INV_Q_DEFECT, defect_delta, INV_OP_PACKED),
    ):
        if delta <= 0:
            continue
        kind_ru = "годный" if kind == INV_Q_GOOD else "брак"
        insert_inventory_move(
            connection,
            product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
            color_id=line["color_id"], color_name=line["color_name"],
            size_id=line["size_id"], size_name=line["size_name"],
            client_id=client_id, client_name=None,
            from_op=INV_OP_PACKING, to_op=to_op,
            from_quality=INV_Q_GOOD, to_quality=kind,
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
              COALESCE(SUM(CASE WHEN zr.to_op='packed' AND zr.to_quality='good' THEN zr.qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN zr.to_quality='defect'  THEN zr.qty ELSE 0 END), 0) AS defect
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


def packing_productivity(
    connection, *,
    date_from: str | None = None,
    date_to: str | None = None,
    client_id: str | None = None,
    search: str | None = None,
) -> dict:
    """Производительность упаковки склада: нетто по дням в разрезе клиент × SKU.

    Считает по QC-движениям журнала (pack_entry_id IS NOT NULL) тем же правилом,
    что и карточка отгрузки (_PACKED_NET_SQL) — отмены вычитаются автоматически,
    т.к. компенсация наследует packed_date оригинала. Полностью отменённые
    записи (нетто 0) в отчёт не попадают.
    """
    conds = ["zr.pack_entry_id IS NOT NULL", "zr.packed_date IS NOT NULL"]
    params: list = []
    if date_from:
        conds.append("zr.packed_date >= ?"); params.append(date_from)
    if date_to:
        conds.append("zr.packed_date <= ?"); params.append(date_to)
    if client_id and client_id.strip():
        conds.append("zr.client_id = ?"); params.append(client_id.strip())
    if search and search.strip():
        s = like_substring_param(search)
        conds.append("(zr.product_sku LIKE ? OR zr.product_name LIKE ?)")
        params += [s, s]
    where = " AND ".join(conds)

    # client_name в QC-движениях не заполняется (record_packing пишет None) — имя из справочника.
    rows = connection.execute(
        f"""SELECT zr.packed_date, zr.client_id,
               MIN(cl.name) AS client_name,
               zr.product_id, MIN(zr.product_sku) AS product_sku, MIN(zr.product_name) AS product_name,
               {_PACKED_NET_SQL.format(p='zr.')}
           FROM zone_relocations zr
           LEFT JOIN clients cl ON cl.id = zr.client_id
           WHERE {where}
           GROUP BY zr.packed_date, zr.client_id, zr.product_id
           ORDER BY zr.packed_date DESC, MIN(cl.name), MIN(zr.product_name)""",
        params,
    ).fetchall()
    doc_rows = connection.execute(
        f"""SELECT zr.packed_date, COUNT(DISTINCT l.doc_id) AS doc_count
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           WHERE {where}
           GROUP BY zr.packed_date""",
        params,
    ).fetchall()
    docs_by_day = {str(r["packed_date"]): int(r["doc_count"] or 0) for r in doc_rows}

    days: list[dict] = []
    by_day: dict[str, dict] = {}
    sku_by_day: dict[str, set[str]] = {}
    for r in rows:
        good, defect = int(r["good"] or 0), int(r["defect"] or 0)
        if good == 0 and defect == 0:
            continue
        day_key = str(r["packed_date"])
        day = by_day.get(day_key)
        if day is None:
            day = {"packed_date": day_key, "good": 0, "defect": 0, "total": 0,
                   "sku_count": 0, "doc_count": docs_by_day.get(day_key, 0), "rows": []}
            by_day[day_key] = day
            sku_by_day[day_key] = set()
            days.append(day)
        day["rows"].append({
            "client_id": r["client_id"], "client_name": r["client_name"],
            "product_id": str(r["product_id"]), "product_sku": r["product_sku"],
            "product_name": r["product_name"],
            "good": good, "defect": defect, "total": good + defect,
        })
        day["good"] += good
        day["defect"] += defect
        day["total"] += good + defect
        sku_by_day[day_key].add(str(r["product_id"]))
        day["sku_count"] = len(sku_by_day[day_key])
    return {
        "days": days,
        "total_good": sum(d["good"] for d in days),
        "total_defect": sum(d["defect"] for d in days),
        "total": sum(d["total"] for d in days),
    }


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
        kind_ru = "брак" if str(r["to_quality"]) == INV_Q_DEFECT else "годный"
        label = r["product_sku"] or r["product_name"]
        qty = int(r["qty"] or 0)
        insert_inventory_move(
            connection,
            product_id=str(r["product_id"]), product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=r["client_id"], client_name=r["client_name"],
            from_op=str(r["to_op"]), to_op=str(r["from_op"]),
            from_quality=str(r["to_quality"]), to_quality=str(r["from_quality"]),
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
    return line_packed_breakdown(connection, line_id)


def _doc_moved_to_packing_qty(connection, doc_id: str) -> int:
    """Сколько по документу всего передано в зону упаковки (движения storage→packing)."""
    row = connection.execute(
        """SELECT COALESCE(SUM(zr.qty), 0) AS moved
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0
             AND zr.from_op = 'storage' AND zr.to_op = 'packing'""",
        (doc_id,),
    ).fetchone()
    return int(row["moved"] or 0)


def _doc_packed_qty(connection, doc_id: str) -> dict:
    """Упаковано по документу: {'good': N, 'defect': M} (net по журналу)."""
    row = connection.execute(
        f"""SELECT {_PACKED_NET_SQL.format(p='zr.')}
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0""",
        (doc_id,),
    ).fetchone()
    return {"good": int(row["good"] or 0), "defect": int(row["defect"] or 0)}


def finish_relocation(connection, doc_id: str, line_inputs, user_id: str) -> str:
    """«Готово»: кладовщик раскидывает упакованный годный/брак по местам.

    Это и есть момент «Готов к отгрузке»: упакованный годный переезжает из «Зоны
    упаковки» packed → ready по реальным местам (становится доступен для отгрузки);
    брак возвращается на хранение свободным (packed,defect → storage,defect). Не
    списывает — отгрузку к рейсу далее возит домен dispatch. Гейт: по каждой строке
    суммы аллокаций должны точно покрыть весь упакованный годный и весь брак.
    Переводит relocating → packed.
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

        for kind, allocs, from_op, to_op in (
            (INV_Q_GOOD, good_allocs, INV_OP_PACKED, INV_OP_READY),
            (INV_Q_DEFECT, defect_allocs, INV_OP_PACKED, INV_OP_STORAGE),
        ):
            kind_ru = "годный" if kind == INV_Q_GOOD else "брак"
            for zone_id, zone_name, qty in allocs:
                insert_inventory_move(
                    connection,
                    product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                    color_id=line["color_id"], color_name=line["color_name"],
                    size_id=line["size_id"], size_name=line["size_name"],
                    client_id=client_id, client_name=None,
                    from_op=from_op, to_op=to_op,
                    from_quality=kind, to_quality=kind,
                    from_zone_id=packing_id, from_zone_name=packing_name,
                    to_zone_id=zone_id, to_zone_name=zone_name,
                    qty=qty, user_id=user_id, shipment_line_id=line_id,
                    comment=f"Перемещение к рейсу ({kind_ru}): {qty} шт → {zone_name or 'без места'} — {label}",
                )
                total_moved += qty

        # Нерешённый пул (подвезли, но не упаковали) возвращаем на хранение,
        # чтобы товар не завис на упаковочном столе и баланс не утекал.
        leftover = line_on_packing_qty(connection, line_id)
        if leftover > 0:
            insert_inventory_move(
                connection,
                product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                color_id=line["color_id"], color_name=line["color_name"],
                size_id=line["size_id"], size_name=line["size_name"],
                client_id=client_id, client_name=None,
                from_op=INV_OP_PACKING, to_op=INV_OP_STORAGE,
                from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                from_zone_id=packing_id, from_zone_name=packing_name,
                to_zone_id=packing_id, to_zone_name=packing_name,
                qty=leftover, user_id=user_id, shipment_line_id=line_id,
                comment=f"Возврат нерешённого пула на хранение: {leftover} шт.",
            )

    if total_moved <= 0:
        raise HTTPException(status_code=400, detail="Нет упакованного товара для перемещения")

    now = _now()
    connection.execute(
        "UPDATE shipment_docs SET status=?, updated_at=? WHERE id=?",
        (SHIPMENT_STATUS_PACKED, now, doc_id),
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_RELOCATE,
         f"Разложено по местам: {total_moved} шт. → Упаковано", now, user_id),
    )
    connection.commit()
    return SHIPMENT_STATUS_PACKED


def _check_defect_lines_ready(connection, doc_id: str, client_id) -> None:
    """Гейт брак-отгрузки перед «Перемещением»: строки есть и брака хватает по клиенту.

    Место не требуется — источники выбирает кладовщик при подготовке;
    здесь проверяется только суммарный остаток брака по позиции.
    """
    from modules.balances.service import get_available_total

    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0", (doc_id,)
    ).fetchall()
    if not lines:
        raise HTTPException(status_code=400, detail="Добавьте товары в отгрузку")
    for line in lines:
        qty = int(line["qty"] or 0)
        if qty <= 0:
            raise HTTPException(status_code=400, detail=f"Укажите количество для «{line['product_name']}»")
        available = get_available_total(
            connection,
            product_id=str(line["product_id"]),
            color_id=line["color_id"],
            size_id=line["size_id"],
            client_id=client_id,
            op=INV_OP_STORAGE,
            quality=INV_Q_DEFECT,
        )
        if available < qty:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Недостаточно брака на хранении для «{line['product_name']}» "
                    f"(нужно {qty}, доступно {available})"
                ),
            )


def finish_defect_relocation(connection, doc_id: str, line_inputs, user_id: str) -> str:
    """«Готово» брак-отгрузки: кладовщик выбирает, откуда берёт брак.

    По каждой строке — аллокации-источники (место + кол-во, можно несколько мест);
    суммы должны точно покрыть план строки. Брак переезжает storage/defect@источник →
    ready/defect@«Зона отгрузки» (доступен для отгрузки). Не списывает — отгрузку к
    рейсу далее возит домен dispatch. Переводит relocating → packed.
    """
    from modules.balances.service import get_available_in_zone, get_shipping_zone, insert_inventory_move

    doc = connection.execute(
        "SELECT status, cargo_type, client_id, client_name FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if normalize_cargo_type(doc["cargo_type"]) != SHIPMENT_CARGO_DEFECT:
        raise HTTPException(status_code=400, detail="Подготовка брака доступна только для брак-отгрузки")
    if str(doc["status"]) != SHIPMENT_STATUS_RELOCATING:
        raise HTTPException(status_code=400, detail="Подготовить брак можно только в статусе «Перемещение»")

    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0", (doc_id,)
    ).fetchall()
    if not lines:
        raise HTTPException(status_code=400, detail="Добавьте товары в отгрузку")
    inputs_by_id = {str(li.line_id): li for li in (line_inputs or [])}

    shipping_id, shipping_name = get_shipping_zone(connection)
    client_id = doc["client_id"]

    total_moved = 0
    for line in lines:
        line_id = str(line["id"])
        qty = int(line["qty"] or 0)
        li = inputs_by_id.get(line_id)
        sources = list(li.sources) if li else []
        if sum(int(s.qty or 0) for s in sources) != qty:
            raise HTTPException(
                status_code=400,
                detail=f"Укажите, откуда берётся весь брак для «{line['product_name']}» (нужно {qty} шт.)",
            )
        label = line["product_sku"] or line["product_name"]
        for src in sources:
            zone_id = (src.zone_id or "").strip()
            src_qty = int(src.qty or 0)
            if not zone_id:
                raise HTTPException(status_code=400, detail="Выберите место-источник для каждой строки")
            if src_qty <= 0:
                raise HTTPException(status_code=400, detail="Укажите количество больше нуля")
            available = get_available_in_zone(
                connection,
                product_id=str(line["product_id"]),
                color_id=line["color_id"],
                size_id=line["size_id"],
                client_id=client_id,
                zone_id=zone_id,
                op=INV_OP_STORAGE,
                quality=INV_Q_DEFECT,
            )
            if available < src_qty:
                zone_label = src.zone_name or "Без места"
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Недостаточно брака в месте «{zone_label}» для «{line['product_name']}» "
                        f"(нужно {src_qty}, доступно {available})"
                    ),
                )
            insert_inventory_move(
                connection,
                product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                color_id=line["color_id"], color_name=line["color_name"],
                size_id=line["size_id"], size_name=line["size_name"],
                client_id=client_id, client_name=doc["client_name"],
                from_op=INV_OP_STORAGE, to_op=INV_OP_READY,
                from_quality=INV_Q_DEFECT, to_quality=INV_Q_DEFECT,
                from_zone_id=zone_id, from_zone_name=src.zone_name,
                to_zone_id=shipping_id, to_zone_name=shipping_name,
                qty=src_qty, user_id=user_id, shipment_line_id=line_id,
                comment=f"Подготовка брака к отгрузке: {src_qty} шт → {shipping_name} — {label}",
            )
            total_moved += src_qty

    if total_moved <= 0:
        raise HTTPException(status_code=400, detail="Нет брака для подготовки к отгрузке")

    now = _now()
    connection.execute(
        "UPDATE shipment_docs SET status=?, updated_at=? WHERE id=?",
        (SHIPMENT_STATUS_PACKED, now, doc_id),
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_RELOCATE,
         f"Брак подготовлен к отгрузке: {total_moved} шт. → Упаковано", now, user_id),
    )
    connection.commit()
    return SHIPMENT_STATUS_PACKED


def return_defect_to_storage(connection, doc_id: str, user_id: str) -> int:
    """Автовозврат при аннулировании брак-отгрузки: брак из зоны отгрузки — на исходные места.

    Обратные движения ready/defect@зона отгрузки → storage/defect по местам-источникам
    из журнала подготовки. Без commit — коммитит вызывающий (аннулирование).
    """
    from modules.balances.service import insert_inventory_move

    doc = connection.execute(
        "SELECT client_id, client_name FROM shipment_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    prep_rows = connection.execute(
        """SELECT zr.shipment_line_id, zr.product_id, MIN(zr.product_name) AS product_name,
                  MIN(zr.product_sku) AS product_sku, zr.color_id, MIN(zr.color_name) AS color_name,
                  zr.size_id, MIN(zr.size_name) AS size_name,
                  zr.from_zone_id, MIN(zr.from_zone_name) AS from_zone_name,
                  zr.to_zone_id, MIN(zr.to_zone_name) AS to_zone_name,
                  COALESCE(SUM(zr.qty), 0) AS qty
           FROM zone_relocations zr
           JOIN shipment_lines sl ON sl.id = zr.shipment_line_id
           WHERE sl.doc_id = ? AND zr.from_op = ? AND zr.to_op = ? AND zr.from_quality = ?
           GROUP BY zr.shipment_line_id, zr.product_id, zr.color_id, zr.size_id, zr.from_zone_id, zr.to_zone_id
           HAVING COALESCE(SUM(zr.qty), 0) > 0""",
        (doc_id, INV_OP_STORAGE, INV_OP_READY, INV_Q_DEFECT),
    ).fetchall()

    total_returned = 0
    for r in prep_rows:
        qty = int(r["qty"] or 0)
        insert_inventory_move(
            connection,
            product_id=str(r["product_id"]), product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=doc["client_id"] if doc else None, client_name=doc["client_name"] if doc else None,
            from_op=INV_OP_READY, to_op=INV_OP_STORAGE,
            from_quality=INV_Q_DEFECT, to_quality=INV_Q_DEFECT,
            from_zone_id=r["to_zone_id"], from_zone_name=r["to_zone_name"],
            to_zone_id=r["from_zone_id"], to_zone_name=r["from_zone_name"],
            qty=qty, user_id=user_id, shipment_line_id=str(r["shipment_line_id"]),
            comment=f"Возврат брака при аннулировании: {qty} шт → {r['from_zone_name'] or 'без места'}",
        )
        total_returned += qty
    return total_returned


def return_packing_pool_to_storage(connection, doc_id: str, user_id: str) -> int:
    """Автовозврат при аннулировании годной отгрузки: нерешённый пул с упаковки — на исходные места.

    Документ можно аннулировать в статусе «В плане», когда товар уже частично
    передан в зону упаковки; без возврата он навсегда зависает в корзине
    «На упаковке» у аннулированного документа. Обратные движения
    packing/good@зона упаковки → storage/good по net исходных мест из журнала
    передачи. Без commit — коммитит вызывающий (аннулирование).
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move

    doc = connection.execute(
        "SELECT client_id FROM shipment_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0", (doc_id,)
    ).fetchall()

    packing_zone: tuple[str, str] | None = None
    total_returned = 0
    for line in lines:
        line_id = str(line["id"])
        pool = line_on_packing_qty(connection, line_id)
        if pool <= 0:
            continue
        if packing_zone is None:
            packing_zone = get_packing_zone(connection)
        packing_id, packing_name = packing_zone

        sources = connection.execute(
            """SELECT zone_id, MIN(zone_name) AS zone_name, SUM(net) AS net FROM (
                   SELECT from_zone_id AS zone_id, from_zone_name AS zone_name, qty AS net
                   FROM zone_relocations
                   WHERE shipment_line_id = ? AND from_op = 'storage' AND to_op = 'packing'
                     AND from_quality = 'good' AND to_quality = 'good'
                   UNION ALL
                   SELECT to_zone_id, to_zone_name, -qty
                   FROM zone_relocations
                   WHERE shipment_line_id = ? AND from_op = 'packing' AND to_op = 'storage'
                     AND from_quality = 'good' AND to_quality = 'good'
               ) t
               GROUP BY zone_id HAVING SUM(net) > 0
               ORDER BY SUM(net) DESC""",
            (line_id, line_id),
        ).fetchall()

        remaining = pool
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
                client_id=doc["client_id"] if doc else None, client_name=None,
                from_op=INV_OP_PACKING, to_op=INV_OP_STORAGE,
                from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                from_zone_id=packing_id, from_zone_name=packing_name,
                to_zone_id=src["zone_id"], to_zone_name=src["zone_name"],
                qty=take, user_id=user_id, shipment_line_id=line_id,
                comment=f"Возврат при аннулировании: {take} шт → {src['zone_name'] or 'без места'}",
            )
            remaining -= take
            total_returned += take
    return total_returned


def _undo_relocation_to_packing(connection, doc_id: str, client_id, user_id: str) -> int:
    """Откат раскладки по местам (finish_relocation) при возврате «Упаковано» → «На упаковке».

    finish_relocation для товара разложил, по каждой строке: годный packed→ready
    (зона упаковки → реальные места), брак packed/defect → storage/defect (по местам),
    нерешённый пул packing/good → storage/good (в самой зоне упаковки). Здесь пишем
    компенсирующие обратные движения, восстанавливая состояние «На упаковке»: годный —
    packed/good@зона упаковки, брак — packed/defect@зона упаковки, пул — packing/good@зона
    упаковки. Net считается по журналу (forward − собственные реверсы), поэтому повторный
    цикл возврат→переупаковка→возврат идемпотентен.

    Гейт: товар не должен быть уже отгружён/привязан рейсом — если в каком-то месте
    готового/брак-остатка меньше, чем нужно вернуть, откат запрещён (сначала отмените рейс).
    Без commit — коммитит вызывающий.
    """
    from modules.balances.service import get_available_in_zone, get_packing_zone, insert_inventory_move

    packing_id, packing_name = get_packing_zone(connection)

    # (signature раскладки, обратная корзина-назначение @ зоне упаковки, ось качества, ярлык).
    # Каждый кортеж: from_op/to_op/quality раскладки + куда вернуть (op,quality) + откуда
    # её брать при проверке доступности (op,quality реальной корзины).
    specs = [
        # Годный: packed→ready по реальным местам → packed/good@зона упаковки.
        dict(fwd_from=INV_OP_PACKED, fwd_to=INV_OP_READY, quality=INV_Q_GOOD,
             back_to_op=INV_OP_PACKED, avail_op=INV_OP_READY, same_zone_only=False, kind_ru="годный"),
        # Брак: packed→storage по местам → packed/defect@зона упаковки.
        dict(fwd_from=INV_OP_PACKED, fwd_to=INV_OP_STORAGE, quality=INV_Q_DEFECT,
             back_to_op=INV_OP_PACKED, avail_op=INV_OP_STORAGE, same_zone_only=False, kind_ru="брак"),
        # Нерешённый пул: packing→storage годного В САМОЙ зоне упаковки → packing/good@зона упаковки.
        dict(fwd_from=INV_OP_PACKING, fwd_to=INV_OP_STORAGE, quality=INV_Q_GOOD,
             back_to_op=INV_OP_PACKING, avail_op=INV_OP_STORAGE, same_zone_only=True, kind_ru="пул"),
    ]

    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0", (doc_id,)
    ).fetchall()

    total = 0
    for line in lines:
        line_id = str(line["id"])
        label = line["product_sku"] or line["product_name"]
        for spec in specs:
            # Чистый остаток раскладки по месту = вошло в место (forward: fwd_from→fwd_to) −
            # уже возвращённое (reverse: avail_op→back_to_op, ведёт ИЗ места обратно в зону
            # упаковки). Реверс детектируется по фактической сигнатуре возвратного движения,
            # чтобы цикл возврат→переупаковка→возврат был идемпотентен.
            zone_filter = (
                "AND m.to_zone_id IS NOT DISTINCT FROM ? AND m.from_zone_id IS NOT DISTINCT FROM ?"
                if spec["same_zone_only"] else ""
            )
            zone_params = [packing_id, packing_id] if spec["same_zone_only"] else []
            rows = connection.execute(
                f"""SELECT zone_id, MIN(zone_name) AS zone_name, SUM(net) AS net FROM (
                       SELECT m.to_zone_id AS zone_id, m.to_zone_name AS zone_name, m.qty AS net
                       FROM zone_relocations m
                       WHERE m.shipment_line_id = ?
                         AND m.from_op = ? AND m.to_op = ?
                         AND m.from_quality = ? AND m.to_quality = ? {zone_filter}
                       UNION ALL
                       SELECT m.from_zone_id, m.from_zone_name, -m.qty
                       FROM zone_relocations m
                       WHERE m.shipment_line_id = ?
                         AND m.from_op = ? AND m.to_op = ?
                         AND m.from_quality = ? AND m.to_quality = ? {zone_filter}
                   ) t
                   GROUP BY zone_id HAVING SUM(net) > 0""",
                [line_id, spec["fwd_from"], spec["fwd_to"], spec["quality"], spec["quality"], *zone_params,
                 line_id, spec["avail_op"], spec["back_to_op"], spec["quality"], spec["quality"], *zone_params],
            ).fetchall()

            for r in rows:
                zone_id = r["zone_id"]
                zone_name = r["zone_name"]
                qty = int(r["net"] or 0)
                if qty <= 0:
                    continue
                avail = get_available_in_zone(
                    connection,
                    product_id=str(line["product_id"]), color_id=line["color_id"], size_id=line["size_id"],
                    client_id=client_id, zone_id=zone_id, op=spec["avail_op"], quality=spec["quality"],
                )
                if avail < qty:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Нельзя вернуть на упаковку «{line['product_name']}»: "
                            f"часть товара уже отгружена или закреплена за рейсом "
                            f"(в месте «{zone_name or 'без места'}» доступно {avail}, нужно {qty}). "
                            "Сначала отмените отгрузку/рейс."
                        ),
                    )
                insert_inventory_move(
                    connection,
                    product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                    color_id=line["color_id"], color_name=line["color_name"],
                    size_id=line["size_id"], size_name=line["size_name"],
                    client_id=client_id, client_name=None,
                    from_op=spec["avail_op"], to_op=spec["back_to_op"],
                    from_quality=spec["quality"], to_quality=spec["quality"],
                    from_zone_id=zone_id, from_zone_name=zone_name,
                    to_zone_id=packing_id, to_zone_name=packing_name,
                    qty=qty, user_id=user_id, shipment_line_id=line_id,
                    comment=f"Возврат на упаковку ({spec['kind_ru']}): {qty} шт ← {zone_name or 'без места'} — {label}",
                )
                total += qty
    return total


def return_to_packing(connection, doc_id: str, user_id: str) -> str:
    """Менеджерский возврат товарной задачи упаковки «на упаковку» (→ on_packing).

    Доступно из «Перемещение» и «Упаковано». Из «Перемещение» — чистая смена статуса
    (остатки между on_packing и relocating не двигались). Из «Упаковано» — сперва
    откатывается раскладка по местам (`_undo_relocation_to_packing`), восстанавливая
    состояние стола упаковки. «Дата упаковки (факт)» сбрасывается — её заново проставит
    следующая передача кладовщику. Брак упаковку минует — для брак-отгрузки запрещено.
    """
    doc = connection.execute(
        "SELECT status, cargo_type, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if normalize_cargo_type(doc["cargo_type"]) == SHIPMENT_CARGO_DEFECT:
        raise HTTPException(status_code=400, detail="Брак-отгрузка минует упаковку — вернуть на упаковку нельзя")
    status = str(doc["status"])
    if status not in (SHIPMENT_STATUS_RELOCATING, SHIPMENT_STATUS_PACKED):
        raise HTTPException(status_code=400, detail="Вернуть на упаковку можно только из «Перемещение» или «Упаковано»")

    returned = 0
    if status == SHIPMENT_STATUS_PACKED:
        returned = _undo_relocation_to_packing(connection, doc_id, doc["client_id"], user_id)

    now = _now()
    connection.execute(
        "UPDATE shipment_docs SET status=?, actual_ship_date=NULL, updated_at=? WHERE id=?",
        (SHIPMENT_STATUS_ON_PACKING, now, doc_id),
    )
    comment = (
        f"Возврат на упаковку из «Упаковано»: раскладка откатана ({returned} шт.)"
        if status == SHIPMENT_STATUS_PACKED
        else "Возврат на упаковку из «Перемещение»"
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_RETURN_TO_PACKING, comment, now, user_id),
    )
    connection.commit()
    return SHIPMENT_STATUS_ON_PACKING


def advance_shipment(connection, doc_id: str, user_id: str, user_role: str) -> str:
    """Переводит документ на следующий статус с ролевым гейтом и проверками фазы.

    Годный груз: draft → packing (Запланировать) · packing → on_packing (Передать на
    упаковку) · on_packing → relocating (Передать кладовщику). relocating →
    packed («Готово») делает отдельный эндпоинт finish_relocation.
    Брак-отгрузка минует упаковку: draft → relocating (Запланировать — задача
    кладовщику подготовить брак); relocating → packed делает
    finish_defect_relocation. Отгрузку к рейсу далее возит домен dispatch.
    """
    row = connection.execute(
        "SELECT status, comment, client_id, cargo_type FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")

    is_defect_cargo = normalize_cargo_type(row["cargo_type"]) == SHIPMENT_CARGO_DEFECT
    transitions = SHIPMENT_TRANSITIONS_DEFECT if is_defect_cargo else SHIPMENT_TRANSITIONS
    roles = SHIPMENT_TRANSITION_ROLES_DEFECT if is_defect_cargo else SHIPMENT_TRANSITION_ROLES

    current = str(row["status"])
    next_status = transitions.get(current)
    if not next_status:
        raise HTTPException(
            status_code=400,
            detail=f"Нельзя продвинуть из статуса «{SHIPMENT_STATUS_LABELS.get(current, current)}»",
        )

    if user_role not in roles.get(next_status, frozenset()):
        raise HTTPException(status_code=403, detail="Недостаточно прав для этого перехода")

    if is_defect_cargo and next_status == SHIPMENT_STATUS_RELOCATING:
        _check_duplicate_lines(connection, doc_id)
        _check_lines_have_sku(connection, doc_id)
        _check_defect_lines_ready(connection, doc_id, row["client_id"])
    elif next_status in (SHIPMENT_STATUS_ASSIGNED, SHIPMENT_STATUS_PACKING):
        # Постановка задачи (draft → assigned) и приёмка её в работу начальником склада
        # (assigned → packing) проверяются одинаково: товар мог уйти со склада за время
        # ожидания приёмки, поэтому покрытие остатком перепроверяется и на приёмке.
        if not str(row["comment"] or "").strip():
            raise HTTPException(status_code=400, detail="Заполните техническое задание")
        _check_duplicate_lines(connection, doc_id)
        _check_lines_have_sku(connection, doc_id)
        _check_lines_covered_by_stock(connection, doc_id, row["client_id"])
    elif next_status == SHIPMENT_STATUS_ON_PACKING:
        if _doc_moved_to_packing_qty(connection, doc_id) <= 0:
            raise HTTPException(status_code=400, detail="Передайте на упаковку хотя бы часть товара")
    elif next_status == SHIPMENT_STATUS_RELOCATING:
        packed = _doc_packed_qty(connection, doc_id)
        if packed["good"] + packed["defect"] <= 0:
            raise HTTPException(status_code=400, detail="Упакуйте хотя бы часть товара перед передачей кладовщику")

    now = _now()
    # «Дата упаковки (факт)» = момент передачи кладовщику на размещение (вход в relocating):
    # для товара — начсмены после упаковки, для брака — менеджер сразу из черновика.
    if next_status == SHIPMENT_STATUS_RELOCATING:
        connection.execute(
            "UPDATE shipment_docs SET status=?, actual_ship_date=COALESCE(actual_ship_date, ?), updated_at=? WHERE id=?",
            (next_status, date.today().isoformat(), now, doc_id),
        )
    else:
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
