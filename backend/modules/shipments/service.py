from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from uuid import uuid4

from fastapi import HTTPException

from config import (
    CONTAINER_OP_CLOSE,
    CONTAINER_OP_ITEM_ADD,
    CONTAINER_OP_ITEM_REMOVE,
    CONTAINER_OP_RELEASE,
    CONTAINER_OP_REOPEN,
    CONTAINER_OP_TAKE,
    CONTAINER_STATUS_CLOSED,
    CONTAINER_STATUS_NEW,
    CONTAINER_STATUS_OPEN,
    CONTAINER_STATUS_PLACED,
    EXTRA_INCOME_OP_CREATE,
    EXTRA_INCOME_REPACK_CATEGORY_NAME,
    INV_OP_PACKED,
    INV_OP_PACKING,
    INV_OP_READY,
    INV_OP_STORAGE,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_OP_BOX_CLOSE,
    SHIPMENT_OP_BOX_PLACE,
    SHIPMENT_OP_BOX_RELEASE,
    SHIPMENT_OP_BOX_TAKE,
    SHIPMENT_OP_COLLECTED,
    SHIPMENT_OP_ITEM_PLACE,
    SHIPMENT_OP_MOVE_RETURN,
    SHIPMENT_OP_PACK,
    SHIPMENT_OP_PACK_CORRECTION,
    SHIPMENT_OP_PACK_DATE_MOVE,
    SHIPMENT_OP_RELOCATE,
    SHIPMENT_OP_REPACK_CHARGE,
    SHIPMENT_OP_REPACK_START,
    SHIPMENT_OP_RETURN_TO_PACKING,
    SHIPMENT_REPACK_FREE,
    SHIPMENT_REPACK_KINDS,
    SHIPMENT_REPACK_PAID,
    SHIPMENT_STATUS_CANCELLED,
    SHIPMENT_STATUS_LABELS,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_PACKED,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_RELOCATING,
    SHIPMENT_TASK_PACKING,
    SHIPMENT_TASK_PUTAWAY,
    SHIPMENT_TRANSITION_ROLES,
    SHIPMENT_TRANSITION_ROLES_DEFECT,
    SHIPMENT_TRANSITION_ROLES_PUTAWAY,
    SHIPMENT_TRANSITIONS,
    SHIPMENT_TRANSITIONS_DEFECT,
    SHIPMENT_TRANSITIONS_PUTAWAY,
)
from dbconn import ci_like_substring_param
from modules.timesheet.service import business_today
from utils import next_doc_number as _next_doc_number, now_iso as _now



def next_doc_number(connection) -> str:
    """Следующий номер задачи упаковки (SHP-NNNN)."""
    return _next_doc_number(connection, table="shipment_docs", prefix="SHP-", width=4)


def normalize_cargo_type(raw: str | None) -> str:
    s = str(raw or SHIPMENT_CARGO_GOOD).strip().lower()
    return s if s in (SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT) else SHIPMENT_CARGO_GOOD


def normalize_task_kind(raw: str | None) -> str:
    """Тип задачи склада: упаковка под отгрузку (по умолчанию) либо упаковка с ТСД."""
    s = str(raw or SHIPMENT_TASK_PACKING).strip().lower()
    return s if s in (SHIPMENT_TASK_PACKING, SHIPMENT_TASK_PUTAWAY) else SHIPMENT_TASK_PACKING


def _dup_key(product_id, color_id, size_id) -> tuple[str, str, str]:
    """Ключ строки для сравнения состава. NULL цвет/размер → ''."""
    return (str(product_id or ""), str(color_id or ""), str(size_id or ""))


def _moscow_day(iso: str | None) -> str:
    """Московская календарная дата из UTC-ISO (fallback, TZ контейнера = Europe/Moscow)."""
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone().date().isoformat()


def find_duplicate_shipments(connection, *, client_id, cargo_type, ship_date, lines) -> list[dict]:
    """Задачи упаковки того же клиента и типа груза за тот же день с ТОЧНО таким же составом.

    День — по плановой дате упаковки (ship_date); если не задана — по дате создания
    за сегодня (МСК). Совпадение = равенство {(товар,цвет,размер): кол-во}. Аннулированные исключены.
    """
    want: dict[tuple[str, str, str], int] = {}
    for ln in lines:
        want[_dup_key(ln.product_id, ln.color_id, ln.size_id)] = int(ln.qty)
    if not client_id or not want:
        return []

    ship = (ship_date or "").strip()
    if ship:
        docs = connection.execute(
            "SELECT id, doc_number, status, created_at, created_by FROM shipment_docs "
            f"WHERE client_id = ? AND COALESCE(cargo_type, '{SHIPMENT_CARGO_GOOD}') = ? AND ship_date = ? AND status != ? AND COALESCE(is_deleted,0)=0 "
            "ORDER BY created_at DESC",
            (client_id, cargo_type, ship, SHIPMENT_STATUS_CANCELLED),
        ).fetchall()
    else:
        today = _moscow_day(_now())
        rows = connection.execute(
            "SELECT id, doc_number, status, created_at, created_by FROM shipment_docs "
            f"WHERE client_id = ? AND COALESCE(cargo_type, '{SHIPMENT_CARGO_GOOD}') = ? AND status != ? AND COALESCE(is_deleted,0)=0 "
            "ORDER BY created_at DESC",
            (client_id, cargo_type, SHIPMENT_STATUS_CANCELLED),
        ).fetchall()
        docs = [r for r in rows if _moscow_day(r["created_at"]) == today]

    matches: list[dict] = []
    for doc in docs:
        line_rows = connection.execute(
            "SELECT product_id, color_id, size_id, qty, product_sku, product_name, color_name, size_name "
            "FROM shipment_lines WHERE doc_id = ? AND COALESCE(is_deleted,0)=0",
            (doc["id"],),
        ).fetchall()
        have = {_dup_key(r["product_id"], r["color_id"], r["size_id"]): int(r["qty"] or 0) for r in line_rows}
        if have != want:
            continue
        email = None
        if doc["created_by"]:
            u = connection.execute("SELECT COALESCE(NULLIF(display_name, ''), email) AS email FROM users WHERE id = ?", (doc["created_by"],)).fetchone()
            email = u["email"] if u else None
        matches.append({
            "id": doc["id"],
            "doc_number": doc["doc_number"],
            "status": doc["status"],
            "status_label": SHIPMENT_STATUS_LABELS.get(doc["status"], doc["status"]),
            "created_at": doc["created_at"],
            "created_by_name": email,
            "lines": [
                {
                    "product_sku": r["product_sku"],
                    "product_name": r["product_name"],
                    "color_name": r["color_name"],
                    "size_name": r["size_name"],
                    "qty": int(r["qty"] or 0),
                }
                for r in line_rows
            ],
        })
    return matches


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

    # Плюс/минус отдельными суммами: ручное перемещение пула по ячейкам
    # (packing→packing) обязано дать нетто 0, а не задвоить пул.
    on_packing_rows = connection.execute(
        f"""SELECT sl.product_id, sl.color_id, sl.size_id,
                  COALESCE(SUM(CASE WHEN zr.to_op = '{INV_OP_PACKING}' AND zr.to_quality = '{INV_Q_GOOD}' THEN zr.qty ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN zr.from_op = '{INV_OP_PACKING}' AND zr.from_quality = '{INV_Q_GOOD}' THEN zr.qty ELSE 0 END), 0) AS on_packing
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


def _move_one_to_packing(
    connection, line, *, packing_id, packing_name, client_id,
    qty: int, from_zone_id: str | None, user_id: str, comment: str,
) -> None:
    """Одна аллокация передачи на упаковку: (storage, good) → (packing, good). Без commit.

    Источник берётся по ЖУРНАЛЬНОМУ остатку storage/good (по факту, где товар лежит),
    а не по местам приёмки: товар cross-dock, который положили сразу в процессную зону
    (упаковки/отгрузки), тоже доступен к передаче. from_zone_id задан — берём только из
    этой зоны; None — по местам с остатком, по убыванию объёма (как при отгрузке).
    """
    from modules.balances.service import insert_inventory_move, ready_zones_for_variant

    if qty <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество для перемещения")

    zones = ready_zones_for_variant(
        connection, product_id=str(line["product_id"]), color_id=line["color_id"],
        size_id=line["size_id"], client_id=client_id, quality=INV_Q_GOOD, op=INV_OP_STORAGE,
    )
    if from_zone_id:
        zones = [z for z in zones if str(z["zone_id"]) == str(from_zone_id)]

    plan = [(z["zone_id"], z["zone_name"], z["net"]) for z in zones]
    total_avail = sum(z["net"] for z in zones)
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


def _move_items_to_packing(connection, doc_id: str, items, user_id: str) -> int:
    """Передача / подвоз товара в «Зону упаковки». items — [(line_id, [(qty, from_zone_id)])].

    Доступно в статусах «В плане» (первичная передача) и «На упаковке» (подвоз, чтобы
    добить план годным при браке). from_zone_id=None означает FIFO по местам.
    Все движения — одной транзакцией, без commit. Возвращает перемещённое количество.
    """
    from modules.balances.service import get_packing_zone

    total = sum(qty for _, allocs in items for qty, _ in allocs)
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

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc["client_id"]
    comment = ("Подвоз на упаковку" if status == SHIPMENT_STATUS_ON_PACKING else "Подготовка к упаковке")
    label_errors = len(items) > 1

    for line_id, allocs in items:
        line = connection.execute(
            "SELECT id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name "
            "FROM shipment_lines WHERE id = ? AND doc_id = ? AND is_deleted = 0",
            (line_id, doc_id),
        ).fetchone()
        if not line:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        label = " · ".join(
            x for x in [line["product_sku"], line["color_name"], line["size_name"]] if x
        ) or line["product_name"]
        for qty, from_zone_id in allocs:
            try:
                _move_one_to_packing(
                    connection, line,
                    packing_id=packing_id, packing_name=packing_name, client_id=client_id,
                    qty=qty, from_zone_id=from_zone_id, user_id=user_id, comment=f"{comment}: {qty} шт.",
                )
            except HTTPException as e:
                if label_errors and e.status_code == 400:
                    raise HTTPException(status_code=400, detail=f"«{label}»: {e.detail}") from e
                raise
    return total


def move_line_to_packing(connection, doc_id: str, line_id: str, allocations, user_id: str) -> int:
    """Передача одной строки по списку аллокаций (зона, кол-во). См. _move_items_to_packing."""
    items = [(str(line_id), [(int(a.qty), a.from_zone_id) for a in (allocations or [])])]
    total = _move_items_to_packing(connection, doc_id, items, user_id)
    connection.commit()
    return total


def move_lines_to_packing(connection, doc_id: str, lines, user_id: str) -> int:
    """Массовая передача нескольких строк одной транзакцией. Без commit.

    lines — список объектов с .line_id и .allocations; строки без аллокаций пропускаются.
    Ошибка по любой строке откатывает всю передачу целиком.
    """
    items = [
        (str(l.line_id), [(int(a.qty), a.from_zone_id) for a in (l.allocations or [])])
        for l in (lines or [])
    ]
    items = [(line_id, allocs) for line_id, allocs in items if allocs]
    if not items:
        raise HTTPException(status_code=400, detail="Укажите количество для перемещения")
    return _move_items_to_packing(connection, doc_id, items, user_id)


def _return_line_packing_pool(
    connection, line, *, client_id, qty: int | None, user_id: str, comment_prefix: str,
) -> int:
    """Компенсирующий возврат пула строки: (packing, good) → (storage, good). Без commit.

    Журнал append-only, поэтому «забрать со стола» — это обратные движения: физически
    пул снимается с фактических ячеек корзины `packing` (её могли вручную переставить
    из зоны упаковки), а адрес назначения берётся из нетто исходных мест передачи.
    qty=None — вернуть весь нерешённый пул. Возвращает фактически возвращённое кол-во.
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move

    line_id = str(line["id"])
    pool = line_on_packing_qty(connection, line_id)
    target = pool if qty is None else min(int(qty), pool)
    if target <= 0:
        return 0

    # Net по исходной зоне = передано из неё − уже возвращённое обратно в неё.
    sources = connection.execute(
        f"""SELECT zone_id, MIN(zone_name) AS zone_name, SUM(net) AS net FROM (
               SELECT from_zone_id AS zone_id, from_zone_name AS zone_name, qty AS net
               FROM zone_relocations
               WHERE shipment_line_id = ? AND from_op = '{INV_OP_STORAGE}' AND to_op = '{INV_OP_PACKING}'
                 AND from_quality = '{INV_Q_GOOD}' AND to_quality = '{INV_Q_GOOD}'
               UNION ALL
               SELECT to_zone_id, to_zone_name, -qty
               FROM zone_relocations
               WHERE shipment_line_id = ? AND from_op = '{INV_OP_PACKING}' AND to_op = '{INV_OP_STORAGE}'
                 AND from_quality = '{INV_Q_GOOD}' AND to_quality = '{INV_Q_GOOD}'
           ) t
           GROUP BY zone_id HAVING SUM(net) > 0
           ORDER BY SUM(net) DESC""",
        (line_id, line_id),
    ).fetchall()

    packing_id, packing_name = get_packing_zone(connection)
    pool_sources = line_bucket_zone_sources(
        connection, line_id, op=INV_OP_PACKING, quality=INV_Q_GOOD, prefer_zone_id=packing_id,
    )
    remaining = target
    for src in sources:
        if remaining <= 0:
            break
        take = min(int(src["net"]), remaining)
        if take <= 0:
            continue
        for pool_zone_id, pool_zone_name, part in _consume_zone_sources(
            pool_sources, take, fallback=(packing_id, packing_name)
        ):
            insert_inventory_move(
                connection,
                product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                color_id=line["color_id"], color_name=line["color_name"],
                size_id=line["size_id"], size_name=line["size_name"],
                client_id=client_id, client_name=None,
                from_op=INV_OP_PACKING, to_op=INV_OP_STORAGE,
                from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                from_zone_id=pool_zone_id, from_zone_name=pool_zone_name,
                to_zone_id=src["zone_id"], to_zone_name=src["zone_name"],
                qty=part, user_id=user_id, shipment_line_id=line_id,
                comment=f"{comment_prefix}: {part} шт → {src['zone_name'] or 'без места'}",
            )
        remaining -= take
    return target - remaining


def return_line_from_packing(connection, doc_id: str, line_id: str, user_id: str, qty: int | None = None) -> int:
    """Откат передачи: возвращает пул «На упаковке» обратно на хранение в исходные места.

    Возвращается только нерешённый пул (упакованное не трогаем). qty=None — весь пул.
    """
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

    pool = line_on_packing_qty(connection, str(line["id"]))
    if pool <= 0:
        raise HTTPException(status_code=400, detail="Нечего возвращать — на упаковке нет нерешённого товара")
    if qty is not None and int(qty) <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество для возврата")

    returned = _return_line_packing_pool(
        connection, line, client_id=doc["client_id"], qty=qty,
        user_id=user_id, comment_prefix="Откат передачи",
    )
    label = line["product_sku"] or line["product_name"]
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_MOVE_RETURN,
         f"Откат передачи на упаковку: {returned} шт — {label}", _now(), user_id),
    )
    connection.commit()
    return returned


def release_line_packing_pool(connection, doc_id: str, line_id: str, user_id: str) -> int:
    """Возврат пула строки на хранение перед удалением строки из состава. Без commit.

    Строку можно удалить и «В плане», когда товар уже увезли в зону упаковки: без
    возврата пул навсегда повисает в корзине «На упаковке» — у удалённой строки его
    больше нечем откатить (аннулирование документа адресует пул по его строкам).
    """
    doc = connection.execute(
        "SELECT client_id FROM shipment_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    line = connection.execute(
        "SELECT id, product_id, product_name, product_sku, color_id, color_name, size_id, size_name "
        "FROM shipment_lines WHERE id = ? AND doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (line_id, doc_id),
    ).fetchone()
    if not line:
        return 0
    return _return_line_packing_pool(
        connection, line, client_id=doc["client_id"] if doc else None, qty=None,
        user_id=user_id, comment_prefix="Удаление строки: возврат с упаковки",
    )


# Net упаковки по журналу (две оси):
#   good  = конвертации в packed (упаковано) минус откаты packed→packing;
#           перевод packed→ready (готовность к отгрузке при «Готово к рейсу») и
#           списание ready→shipped факт упаковки не меняют — число «упаковано» держится;
#   defect = конвертации качества good→defect минус обратные. Раскладка брака
#           (packed→storage с тем же качеством) и списание факт не меняют.
# Скан товара в короб (задача с ТСД) — тот же факт упаковки в `packed` (и та же
# оплата кладовщику), а развозка короба (packed → ready) факт не отменяет.
_PACKED_SET_SQL = ", ".join(f"'{s}'" for s in (INV_OP_PACKED, INV_OP_READY))

# Сторно прямого размещения (storage → packed) входит в набор «извне» и без отсева
# компенсаций читалось бы как новая упаковка — отмена вернула бы объём вместо того,
# чтобы его снять. Обратные записи в плюс не идут никогда: они только вычитают.
_PACKED_NET_SQL = f"""
    COALESCE(SUM(CASE WHEN {{p}}to_op IN ({_PACKED_SET_SQL})   AND {{p}}to_quality='{INV_Q_GOOD}'   AND COALESCE({{p}}from_op,'') NOT IN ({_PACKED_SET_SQL}) AND {{p}}reverses_id IS NULL THEN {{p}}qty
                      WHEN {{p}}from_op IN ({_PACKED_SET_SQL}) AND {{p}}from_quality='{INV_Q_GOOD}' AND {{p}}to_op='{INV_OP_PACKING}'                        THEN -{{p}}qty
                      ELSE 0 END), 0) AS good,
    COALESCE(SUM(CASE WHEN {{p}}to_quality='{INV_Q_DEFECT}'   AND COALESCE({{p}}from_quality,'')<>'{INV_Q_DEFECT}' THEN {{p}}qty
                      WHEN {{p}}from_quality='{INV_Q_DEFECT}' AND COALESCE({{p}}to_quality,'')<>'{INV_Q_DEFECT}'   THEN -{{p}}qty
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


def line_packed_pending(connection, line_id: str) -> dict:
    """Упаковано, но ещё НЕ размещено по местам: чистый остаток корзины `packed` строки.

    В отличие от line_packed_breakdown (факт упаковки = packed+ready, держится после
    размещения), это то, что физически лежит на столе «Упаковано» и ждёт раскладки.
    Размещение good (packed→ready) и defect (packed→storage) его уменьшает; возврат на
    упаковку (ready→packed) — увеличивает. На этом считается частичное и финальное
    размещение, чтобы повторная раскладка не задваивала уже размещённое.
    Плюс и минус — отдельными суммами: ручное перемещение упакованного по ячейкам
    (packed→packed) обязано дать нетто 0."""
    row = connection.execute(
        f"""SELECT
              COALESCE(SUM(CASE WHEN to_op='{INV_OP_PACKED}' AND to_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN from_op='{INV_OP_PACKED}' AND from_quality='{INV_Q_GOOD}' THEN qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN to_op='{INV_OP_PACKED}' AND to_quality='{INV_Q_DEFECT}' THEN qty ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN from_op='{INV_OP_PACKED}' AND from_quality='{INV_Q_DEFECT}' THEN qty ELSE 0 END), 0) AS defect
           FROM zone_relocations WHERE shipment_line_id = ?""",
        (line_id,),
    ).fetchone()
    return {"good": int(row["good"] or 0), "defect": int(row["defect"] or 0)}


def close_drained_packing_tasks(connection, shipment_line_ids, user_id: str) -> int:
    """Авто-закрытие упаковочных задач, чей упакованный уехал рейсом (relocating → packed).

    Вызывается доменом «Отгрузка» при выезде рейса прямо из «Упаковано»: списание
    `packed` атрибутировано к строкам упаковки, поэтому раскладывать кладовщику больше
    нечего. Закрываем только задачи в статусе «Перемещение» (relocating), у которых по
    ВСЕМ строкам не осталось упакованного (`line_packed_pending` good+defect = 0) — это
    то же конечное состояние, что и ручное «Готово к рейсу» (finish_relocation), только
    без раскладки по местам. Задачи, где ещё упаковывают (on_packing), не трогаем. Без
    commit — коммитит вызывающий каскад рейса. Возвращает число закрытых задач.
    """
    if not shipment_line_ids:
        return 0
    placeholders = ",".join("?" for _ in shipment_line_ids)
    doc_rows = connection.execute(
        f"SELECT DISTINCT doc_id FROM shipment_lines WHERE id IN ({placeholders})",
        list(shipment_line_ids),
    ).fetchall()

    closed = 0
    now = _now()
    for dr in doc_rows:
        doc_id = str(dr["doc_id"])
        doc = connection.execute(
            "SELECT status FROM shipment_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchone()
        if not doc or str(doc["status"]) != SHIPMENT_STATUS_RELOCATING:
            continue
        lines = connection.execute(
            "SELECT id FROM shipment_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
        ).fetchall()
        if any(
            line_packed_pending(connection, str(l["id"]))["good"]
            + line_packed_pending(connection, str(l["id"]))["defect"] > 0
            for l in lines
        ):
            continue
        connection.execute(
            "UPDATE shipment_docs SET status = ?, updated_at = ? WHERE id = ?",
            (SHIPMENT_STATUS_PACKED, now, doc_id),
        )
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_RELOCATE,
             "Упаковано: товар уехал рейсом из упаковки (задача закрыта автоматически)", now, user_id),
        )
        _finalize_repack(connection, doc_id, user_id)
        closed += 1
    return closed


def _relocate_alloc_zone(a) -> tuple[str, str | None, int]:
    """Одна аллокация раскладки → (zone_id, zone_name, qty) с валидацией."""
    zone_id = (a.zone_id or "").strip()
    qty = int(a.qty or 0)
    if not zone_id:
        raise HTTPException(status_code=400, detail="Выберите место для каждой строки перемещения")
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество больше нуля")
    return zone_id, (a.zone_name or None), qty


def _emit_packed_placement(
    connection, line, *, client_id, packing_id, packing_name,
    good_allocs, defect_allocs, user_id, comment_prefix: str,
) -> int:
    """Перенос упакованного по местам: good packed→ready, defect packed→storage. Без commit.

    Возвращает суммарно перемещённое. Общий код частичного (on_packing) и финального
    (relocating → packed) размещения."""
    from modules.balances.service import insert_inventory_move

    label = line["product_sku"] or line["product_name"]
    total = 0
    for kind, allocs, to_op in (
        (INV_Q_GOOD, good_allocs, INV_OP_READY),
        (INV_Q_DEFECT, defect_allocs, INV_OP_STORAGE),
    ):
        if not allocs:
            continue
        kind_ru = "годный" if kind == INV_Q_GOOD else "брак"
        # Упакованное могли вручную переставить из зоны упаковки — забираем из
        # фактических ячеек корзины `packed` (FIFO, зона упаковки первой).
        sources = line_bucket_zone_sources(
            connection, str(line["id"]), op=INV_OP_PACKED, quality=kind, prefer_zone_id=packing_id,
        )
        for zone_id, zone_name, qty in allocs:
            for src_zone_id, src_zone_name, take in _consume_zone_sources(
                sources, qty, fallback=(packing_id, packing_name)
            ):
                insert_inventory_move(
                    connection,
                    product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                    color_id=line["color_id"], color_name=line["color_name"],
                    size_id=line["size_id"], size_name=line["size_name"],
                    client_id=client_id, client_name=None,
                    from_op=INV_OP_PACKED, to_op=to_op,
                    from_quality=kind, to_quality=kind,
                    from_zone_id=src_zone_id, from_zone_name=src_zone_name,
                    to_zone_id=zone_id, to_zone_name=zone_name,
                    qty=take, user_id=user_id, shipment_line_id=str(line["id"]),
                    comment=f"{comment_prefix} ({kind_ru}): {take} шт → {zone_name or 'без места'} — {label}",
                )
            total += qty
    return total


def line_bucket_zone_sources(
    connection, line_id: str, *, op: str, quality: str, prefer_zone_id: str | None = None,
) -> list[dict]:
    """Ячейки, где по журналу физически лежит корзина (op, quality) строки (net > 0).

    Товар на упаковке/упакованный могли вручную переставить из зоны упаковки в другую
    ячейку (ручное перемещение остатков работает для packing/packed) — процессные
    списания обязаны уходить из фактических ячеек, иначе остатки по местам разойдутся.
    prefer_zone_id (обычно зона упаковки) отдаётся первым, остальные — по убыванию
    нетто. Возвращает мутируемые {'zone_id','zone_name','net'} для FIFO-потребления.
    """
    rows = connection.execute(
        """SELECT zone_id, MIN(zone_name) AS zone_name, SUM(net) AS net FROM (
               SELECT to_zone_id AS zone_id, to_zone_name AS zone_name, qty AS net
               FROM zone_relocations
               WHERE shipment_line_id = ? AND to_op = ? AND to_quality = ?
               UNION ALL
               SELECT from_zone_id, from_zone_name, -qty
               FROM zone_relocations
               WHERE shipment_line_id = ? AND from_op = ? AND from_quality = ?
           ) t
           GROUP BY zone_id HAVING SUM(net) > 0
           ORDER BY SUM(net) DESC""",
        (line_id, op, quality, line_id, op, quality),
    ).fetchall()
    sources = [{"zone_id": r["zone_id"], "zone_name": r["zone_name"], "net": int(r["net"])} for r in rows]
    if prefer_zone_id is not None:
        sources.sort(key=lambda s: 0 if s["zone_id"] == prefer_zone_id else 1)
    return sources


def _consume_zone_sources(
    sources: list[dict], qty: int, *, fallback: tuple[str | None, str | None],
) -> list[tuple[str | None, str | None, int]]:
    """FIFO-съём количества с пула ячеек: [(zone_id, zone_name, take)]. Мутирует sources.

    Гейты процессов считают доступность по нетто строки (все ячейки разом), поэтому
    положительных ячеек может не хватить при историческом дрейфе по местам — остаток
    пишется из fallback-зоны (легаси-поведение: зона упаковки), а не падает.
    """
    parts: list[tuple[str | None, str | None, int]] = []
    remaining = int(qty)
    for src in sources:
        if remaining <= 0:
            break
        take = min(remaining, src["net"])
        if take <= 0:
            continue
        parts.append((src["zone_id"], src["zone_name"], take))
        src["net"] -= take
        remaining -= take
    if remaining > 0:
        parts.append((fallback[0], fallback[1], remaining))
    return parts


def line_on_packing_qty(connection, line_id: str) -> int:
    """Нерешённый пул строки на упаковочном столе: net (packing, good) по журналу.

    Плюс и минус считаются отдельными суммами (не одним CASE): ручное перемещение
    пула по ячейкам — движение packing→packing, обе стороны в одной записи, и она
    должна дать нетто 0, а не задвоить пул.
    """
    row = connection.execute(
        f"""SELECT
              COALESCE(SUM(CASE WHEN to_op = '{INV_OP_PACKING}' AND to_quality = '{INV_Q_GOOD}' THEN qty ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN from_op = '{INV_OP_PACKING}' AND from_quality = '{INV_Q_GOOD}' THEN qty ELSE 0 END), 0) AS qty
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
    container_id: str | None = None,
) -> dict:
    """QC при упаковке: вносит годный и/или брак одной записью с датой упаковки.

    Обе дельты неотрицательны (коррекция — через reverse_packing_entry). good+defect
    одного «Записать» получают общий pack_entry_id для группировки/отмены.

    Упаковка с ТСД (task_kind=putaway) вносится не разово числом, а поштучно: каждый
    скан — это и есть запись упаковки. Короб в такой задаче просто тара: и годный, и
    брак уходят в ту же корзину `packed` — в коробе (ось container_id) или без него
    (габарит, брак). Упакованное доступно отгрузке сразу; в зону отгрузки (`ready`)
    короба и россыпь везёт отдельный процесс развозки.
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
        "SELECT status, client_id, task_kind, repack_active, repack_kind, repack_price_kop "
        "FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc_row:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if str(doc_row["status"]) != SHIPMENT_STATUS_ON_PACKING:
        raise HTTPException(status_code=400, detail="Упаковку можно вносить только в статусе «На упаковке»")

    is_putaway = normalize_task_kind(doc_row["task_kind"]) == SHIPMENT_TASK_PUTAWAY

    # Задача на переупаковке: новые pack-записи штампуются её видом — free не попадает
    # в деньги производительности, paid тарифицируется клиенту при завершении задачи.
    repack_kind = (
        str(doc_row["repack_kind"])
        if int(doc_row["repack_active"] or 0) and doc_row["repack_kind"] else None
    )
    repack_price_kop = (
        int(doc_row["repack_price_kop"])
        if repack_kind == SHIPMENT_REPACK_PAID and doc_row["repack_price_kop"] is not None else None
    )
    repack_suffix = {
        SHIPMENT_REPACK_FREE: " (переупаковка без оплаты)",
        SHIPMENT_REPACK_PAID: " (переупаковка за счёт клиента)",
    }.get(repack_kind or "", "")

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
    # И годный, и найденный брак уходят одной корзиной «Упаковано» (packed); у задачи с
    # ТСД — с осью короба. В ready годное переводит раскладка: «Готово к рейсу»
    # (finish_relocation) либо развозка коробов; брак у задачи упаковки там же
    # вернётся на хранение.
    # Пул «На упаковке» могли вручную переставить из зоны упаковки по ячейкам —
    # списываем из фактических мест (FIFO, зона упаковки первой). Упакованное
    # складывается в зоне упаковки.
    sources = line_bucket_zone_sources(
        connection, line_id, op=INV_OP_PACKING, quality=INV_Q_GOOD, prefer_zone_id=packing_id,
    )
    for kind, delta in ((INV_Q_GOOD, good_delta), (INV_Q_DEFECT, defect_delta)):
        if delta <= 0:
            continue
        kind_ru = "годный" if kind == INV_Q_GOOD else "брак"
        for src_zone_id, src_zone_name, take in _consume_zone_sources(
            sources, delta, fallback=(packing_id, packing_name)
        ):
            insert_inventory_move(
                connection,
                product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                color_id=line["color_id"], color_name=line["color_name"],
                size_id=line["size_id"], size_name=line["size_name"],
                client_id=client_id, client_name=None,
                from_op=INV_OP_PACKING, to_op=INV_OP_PACKED,
                from_quality=INV_Q_GOOD, to_quality=kind,
                from_zone_id=src_zone_id, from_zone_name=src_zone_name,
                to_zone_id=packing_id, to_zone_name=packing_name,
                qty=take, user_id=user_id, shipment_line_id=line_id,
                to_container_id=container_id,
                comment=(
                    f"Упаковка в короб ({kind_ru}): +{take} шт." if container_id
                    else f"Упаковка без короба ({kind_ru}): +{take} шт." if is_putaway
                    else f"Упаковка ({kind_ru}): +{take} шт."
                ),
                packed_date=packed_date, pack_entry_id=pack_entry_id,
                repack_kind=repack_kind, repack_price_kop=repack_price_kop,
            )
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_PACK,
             f"Упаковка {kind_ru} ({packed_date}): +{delta} шт. — {label}{repack_suffix}", _now(), user_id),
        )
    return line_packed_breakdown(connection, line_id)


def list_packing_entries(connection, line_id: str) -> list[dict]:
    """История записей упаковки строки: одна строка истории на pack_entry_id.

    Отдаёт только первичные записи (reverses_id IS NULL); reversed=true, если по записи
    есть компенсация. Строки-компенсации в список не попадают.
    """
    rows = connection.execute(
        f"""SELECT zr.pack_entry_id AS id,
              MIN(zr.packed_date) AS packed_date,
              MIN(zr.created_at) AS created_at,
              MIN(zr.created_by) AS created_by,
              MIN(COALESCE(NULLIF(u.display_name, ''), u.email)) AS created_by_email,
              MIN(zr.repack_kind) AS repack_kind,
              COALESCE(SUM(CASE WHEN zr.to_op='{INV_OP_PACKED}' AND zr.to_quality='{INV_Q_GOOD}' THEN zr.qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN zr.to_quality='{INV_Q_DEFECT}'  THEN zr.qty ELSE 0 END), 0) AS defect
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
            "repack_kind": r["repack_kind"],
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
    with_earnings: bool = False,
) -> dict:
    """Производительность упаковки склада: нетто по дням в разрезе клиент × SKU.

    Считает по QC-движениям журнала (pack_entry_id IS NOT NULL) тем же правилом,
    что и карточка отгрузки (_PACKED_NET_SQL) — отмены вычитаются автоматически,
    т.к. компенсация наследует packed_date оригинала. Полностью отменённые
    записи (нетто 0) в отчёт не попадают.

    with_earnings — добавить стоимость (заработок): qty × тариф упаковки на дату
    упаковки, раздельно годный/брак. Только для ролей, видящих деньги (менеджер).
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
        s = ci_like_substring_param(search)
        conds.append("(fold_ci(zr.product_sku) LIKE ? OR fold_ci(zr.product_name) LIKE ? OR zr.product_id IN (SELECT id FROM products WHERE fold_ci(sku) LIKE ?))")
        params += [s, s, s]
    where = " AND ".join(conds)

    # client_name в QC-движениях не заполняется (record_packing пишет None) — имя из справочника.
    # repack_kind/repack_price_kop в группировке: объём переупаковки — отдельной строкой
    # (free — осознанный 0 ₽, paid — тарифицируется кастомной ценой либо тарифом).
    rows = connection.execute(
        f"""SELECT zr.packed_date, zr.client_id,
               MIN(cl.name) AS client_name,
               zr.product_id,
               COALESCE(NULLIF(TRIM(MIN(p.sku)), ''), MIN(zr.product_sku)) AS product_sku,
               MIN(zr.product_name) AS product_name,
               zr.repack_kind, zr.repack_price_kop,
               {_PACKED_NET_SQL.format(p='zr.')}
           FROM zone_relocations zr
           LEFT JOIN products p ON p.id = zr.product_id
           LEFT JOIN clients cl ON cl.id = zr.client_id
           WHERE {where}
           GROUP BY zr.packed_date, zr.client_id, zr.product_id, zr.repack_kind, zr.repack_price_kop
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

    # Документы-источники по каждой строке (день × клиент × SKU) — для перехода
    # из отчёта в карточку «Задачи упаковки». Чаще всего ровно один.
    doc_id_rows = connection.execute(
        f"""SELECT zr.packed_date, zr.client_id, zr.product_id,
               array_agg(DISTINCT l.doc_id) AS doc_ids
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           WHERE {where}
           GROUP BY zr.packed_date, zr.client_id, zr.product_id""",
        params,
    ).fetchall()
    doc_ids_by_row = {
        (str(r["packed_date"]), r["client_id"], str(r["product_id"])):
            [str(d) for d in (r["doc_ids"] or [])]
        for r in doc_id_rows
    }

    histories: dict = {}
    if with_earnings:
        from modules.pricing.service import load_histories
        histories = load_histories(connection, [str(r["product_id"]) for r in rows])

    def _priced(product_id, cid, quality, qty, day_iso, repack_kind=None, repack_price=None):
        """(earn_kop, price_missing) по одной оси качества. price_missing — есть
        штуки, но тариф упаковки на эту дату не заведён (менеджер видит «не задана»).
        Переупаковка: free — осознанный 0 ₽ без price_missing (это не дыра в тарифах);
        paid с кастомной ценой — она вместо тарифа, paid без цены — стандартный тариф."""
        if not with_earnings or not cid or qty <= 0:
            return 0, False
        if repack_kind == SHIPMENT_REPACK_FREE:
            return 0, False
        if repack_kind == SHIPMENT_REPACK_PAID and repack_price is not None:
            return repack_price * qty, False
        from modules.pricing.service import price_on
        price = price_on(histories.get((str(product_id), str(cid), quality)), day_iso)
        if price is None:
            return 0, True
        return price * qty, False

    days: list[dict] = []
    by_day: dict[str, dict] = {}
    sku_by_day: dict[str, set[str]] = {}
    for r in rows:
        good, defect = int(r["good"] or 0), int(r["defect"] or 0)
        if good == 0 and defect == 0:
            continue
        day_key = str(r["packed_date"])
        cid = r["client_id"]
        repack_kind = str(r["repack_kind"]) if r["repack_kind"] else None
        repack_price = int(r["repack_price_kop"]) if r["repack_price_kop"] is not None else None
        good_earn, good_missing = _priced(r["product_id"], cid, INV_Q_GOOD, good, day_key, repack_kind, repack_price)
        defect_earn, defect_missing = _priced(r["product_id"], cid, INV_Q_DEFECT, defect, day_key, repack_kind, repack_price)
        day = by_day.get(day_key)
        if day is None:
            day = {"packed_date": day_key, "good": 0, "defect": 0, "total": 0,
                   "good_earn_kop": 0, "defect_earn_kop": 0, "earn_kop": 0,
                   "sku_count": 0, "doc_count": docs_by_day.get(day_key, 0), "rows": []}
            by_day[day_key] = day
            sku_by_day[day_key] = set()
            days.append(day)
        day["rows"].append({
            "client_id": cid, "client_name": r["client_name"],
            "product_id": str(r["product_id"]), "product_sku": r["product_sku"],
            "product_name": r["product_name"],
            "good": good, "defect": defect, "total": good + defect,
            "good_earn_kop": good_earn, "defect_earn_kop": defect_earn,
            "earn_kop": good_earn + defect_earn,
            "price_missing": good_missing or defect_missing,
            "repack_kind": repack_kind,
            "doc_ids": doc_ids_by_row.get((day_key, cid, str(r["product_id"])), []),
        })
        day["good"] += good
        day["defect"] += defect
        day["total"] += good + defect
        day["good_earn_kop"] += good_earn
        day["defect_earn_kop"] += defect_earn
        day["earn_kop"] += good_earn + defect_earn
        sku_by_day[day_key].add(str(r["product_id"]))
        day["sku_count"] = len(sku_by_day[day_key])
    return {
        "days": days,
        "total_good": sum(d["good"] for d in days),
        "total_defect": sum(d["defect"] for d in days),
        "total": sum(d["total"] for d in days),
        "total_good_earn_kop": sum(d["good_earn_kop"] for d in days),
        "total_defect_earn_kop": sum(d["defect_earn_kop"] for d in days),
        "total_earn_kop": sum(d["earn_kop"] for d in days),
        "with_earnings": with_earnings,
    }


def packing_day_detail(
    connection, *, date: str, client_id: str | None = None, with_earnings: bool = False,
) -> dict:
    """Детализация упаковки за один день по задачам упаковки (shipment-документам).

    Клик по столбику графика аналитики упаковки: показывает, из каких «Задач
    упаковки» сложился день, с разбивкой по SKU внутри каждой задачи и переходом
    в карточку задачи. Считает тем же нетто-правилом (_PACKED_NET_SQL), что и
    packing_productivity — цифры совпадают со столбиком.
    """
    conds = ["zr.pack_entry_id IS NOT NULL", "zr.packed_date = ?"]
    params: list = [date]
    if client_id and client_id.strip():
        conds.append("zr.client_id = ?"); params.append(client_id.strip())
    where = " AND ".join(conds)

    rows = connection.execute(
        f"""SELECT l.doc_id,
               MIN(d.doc_number) AS doc_number,
               MIN(d.status) AS status,
               zr.client_id,
               MIN(cl.name) AS client_name,
               zr.product_id,
               COALESCE(NULLIF(TRIM(MIN(p.sku)), ''), MIN(zr.product_sku)) AS product_sku,
               MIN(zr.product_name) AS product_name,
               zr.repack_kind, zr.repack_price_kop,
               {_PACKED_NET_SQL.format(p='zr.')}
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           JOIN shipment_docs d ON d.id = l.doc_id
           LEFT JOIN products p ON p.id = zr.product_id
           LEFT JOIN clients cl ON cl.id = zr.client_id
           WHERE {where}
           GROUP BY l.doc_id, zr.client_id, zr.product_id, zr.repack_kind, zr.repack_price_kop
           ORDER BY MIN(d.doc_number), MIN(zr.product_name)""",
        params,
    ).fetchall()

    histories: dict = {}
    if with_earnings:
        from modules.pricing.service import load_histories
        histories = load_histories(connection, [str(r["product_id"]) for r in rows])

    def _priced(product_id, cid, quality, qty, repack_kind=None, repack_price=None) -> tuple[int, bool]:
        if not with_earnings or not cid or qty <= 0:
            return 0, False
        if repack_kind == SHIPMENT_REPACK_FREE:
            return 0, False
        if repack_kind == SHIPMENT_REPACK_PAID and repack_price is not None:
            return repack_price * qty, False
        from modules.pricing.service import price_on
        price = price_on(histories.get((str(product_id), str(cid), quality)), date)
        if price is None:
            return 0, True
        return price * qty, False

    docs: list[dict] = []
    by_doc: dict[str, dict] = {}
    for r in rows:
        good, defect = int(r["good"] or 0), int(r["defect"] or 0)
        if good == 0 and defect == 0:
            continue
        doc_id = str(r["doc_id"])
        cid = r["client_id"]
        repack_kind = str(r["repack_kind"]) if r["repack_kind"] else None
        repack_price = int(r["repack_price_kop"]) if r["repack_price_kop"] is not None else None
        good_earn, good_missing = _priced(r["product_id"], cid, INV_Q_GOOD, good, repack_kind, repack_price)
        defect_earn, defect_missing = _priced(r["product_id"], cid, INV_Q_DEFECT, defect, repack_kind, repack_price)
        earn = good_earn + defect_earn
        price_missing = good_missing or defect_missing
        doc = by_doc.get(doc_id)
        if doc is None:
            doc = {
                "doc_id": doc_id, "doc_number": r["doc_number"], "status": str(r["status"]),
                "client_id": cid, "client_name": r["client_name"],
                "good": 0, "defect": 0, "total": 0, "earn_kop": 0,
                "price_missing": False, "lines": [],
            }
            by_doc[doc_id] = doc
            docs.append(doc)
        doc["lines"].append({
            "product_id": str(r["product_id"]), "product_sku": r["product_sku"],
            "product_name": r["product_name"],
            "good": good, "defect": defect, "total": good + defect,
            "earn_kop": earn, "price_missing": price_missing,
            "repack_kind": repack_kind,
        })
        doc["good"] += good
        doc["defect"] += defect
        doc["total"] += good + defect
        doc["earn_kop"] += earn
        doc["price_missing"] = doc["price_missing"] or price_missing

    return {
        "packed_date": date,
        "good": sum(d["good"] for d in docs),
        "defect": sum(d["defect"] for d in docs),
        "total": sum(d["total"] for d in docs),
        "earn_kop": sum(d["earn_kop"] for d in docs),
        "with_earnings": with_earnings,
        "docs": docs,
    }


def list_productivity_entries(
    connection, *, packed_date: str, client_id: str | None, product_id: str,
) -> list[dict]:
    """Pack-записи одной строки отчёта (день × клиент × SKU) — для шторки переноса даты.

    Только первичные записи (reverses_id IS NULL); reversed=true, если по записи есть
    компенсация. Отдаёт документ-источник по каждой записи (перенос двигает и сторно).
    """
    rows = connection.execute(
        """SELECT zr.pack_entry_id AS id,
              MIN(zr.packed_date) AS packed_date,
              MIN(zr.created_at) AS created_at,
              MIN(COALESCE(NULLIF(u.display_name, ''), u.email)) AS created_by_email,
              MIN(l.doc_id) AS doc_id,
              MIN(d.doc_number) AS doc_number,
              COALESCE(SUM(CASE WHEN zr.to_op = ? AND zr.to_quality = ? THEN zr.qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN zr.to_quality = ? THEN zr.qty ELSE 0 END), 0) AS defect
           FROM zone_relocations zr
           LEFT JOIN users u ON u.id = zr.created_by
           LEFT JOIN shipment_lines l ON l.id = zr.shipment_line_id
           LEFT JOIN shipment_docs d ON d.id = l.doc_id
           WHERE zr.pack_entry_id IS NOT NULL AND zr.reverses_id IS NULL
             AND zr.packed_date = ?
             AND zr.client_id IS NOT DISTINCT FROM ?
             AND zr.product_id = ?
           GROUP BY zr.pack_entry_id
           ORDER BY MIN(zr.created_at) DESC""",
        (INV_OP_PACKED, INV_Q_GOOD, INV_Q_DEFECT, packed_date, client_id, product_id),
    ).fetchall()
    ids = [str(r["id"]) for r in rows]
    reversed_ids: set[str] = set()
    if ids:
        ph = ",".join(["?"] * len(ids))
        rev = connection.execute(
            f"SELECT DISTINCT reverses_id FROM zone_relocations WHERE reverses_id IN ({ph})",
            ids,
        ).fetchall()
        reversed_ids = {str(r["reverses_id"]) for r in rev}
    return [
        {
            "id": str(r["id"]),
            "packed_date": r["packed_date"],
            "good": int(r["good"] or 0),
            "defect": int(r["defect"] or 0),
            "created_at": str(r["created_at"]),
            "created_by_email": r["created_by_email"],
            "doc_id": str(r["doc_id"]) if r["doc_id"] else None,
            "doc_number": r["doc_number"],
            "reversed": str(r["id"]) in reversed_ids,
        }
        for r in rows
    ]


def move_packing_date(connection, entry_ids: list[str], new_date: str, user_id: str) -> dict:
    """Админ переносит бизнес-дату упаковки на другой день (историческая коррекция).

    Двигает packed_date у выбранных pack-записей И их сторно (reverses_id наследует
    дату оригинала), чтобы нетто по дням оставался консистентным. Затрагивает только
    метку даты — остаток (опер.статус × качество × qty) и статус документа не меняются,
    поэтому разрешено на любом статусе, включая отгруженные. Заработок в отчёте
    пересчитывается сам — тариф берётся на packed_date.
    """
    new_date = _validate_packed_date(new_date)
    ids = [str(e).strip() for e in (entry_ids or []) if str(e).strip()]
    if not ids:
        raise HTTPException(status_code=400, detail="Не выбрано ни одной записи упаковки")

    ph = ",".join(["?"] * len(ids))
    rows = connection.execute(
        f"""SELECT zr.pack_entry_id AS id,
              MIN(zr.packed_date) AS old_date,
              MIN(l.doc_id) AS doc_id,
              MIN(COALESCE(NULLIF(zr.product_sku, ''), zr.product_name)) AS label,
              COALESCE(SUM(CASE WHEN zr.to_op = ? AND zr.to_quality = ? THEN zr.qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN zr.to_quality = ? THEN zr.qty ELSE 0 END), 0) AS defect
           FROM zone_relocations zr
           LEFT JOIN shipment_lines l ON l.id = zr.shipment_line_id
           WHERE zr.pack_entry_id IN ({ph}) AND zr.reverses_id IS NULL
           GROUP BY zr.pack_entry_id""",
        (INV_OP_PACKED, INV_Q_GOOD, INV_Q_DEFECT, *ids),
    ).fetchall()
    found = {str(r["id"]): r for r in rows}
    missing = [e for e in ids if e not in found]
    if missing:
        raise HTTPException(status_code=404, detail="Часть записей упаковки не найдена")

    moved = 0
    for entry_id in ids:
        r = found[entry_id]
        old_date = str(r["old_date"])
        if old_date == new_date:
            continue
        connection.execute(
            "UPDATE zone_relocations SET packed_date = ? "
            "WHERE (pack_entry_id = ? OR reverses_id = ?) AND packed_date IS NOT NULL",
            (new_date, entry_id, entry_id),
        )
        moved += 1
        doc_id = r["doc_id"]
        if doc_id:
            label = (r["label"] or "").strip()
            comment = (
                f"Перенос даты упаковки: {old_date} → {new_date} "
                f"(годный {int(r['good'] or 0)} · брак {int(r['defect'] or 0)} шт.)"
            )
            if label:
                comment += f" — {label}"
            connection.execute(
                "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
                (str(uuid4()), str(doc_id), SHIPMENT_OP_PACK_DATE_MOVE, comment, _now(), user_id),
            )
    return {"moved": moved}


def reverse_packing_entry(connection, doc_id: str, line_id: str, entry_id: str, user_id: str) -> dict:
    """Отмена ошибочной записи упаковки: пишет обратные движения (append-only).

    Чистый откат — план/пул не валидируем. Повторная отмена запрещена.
    """
    from modules.balances.service import insert_inventory_move

    doc_row = connection.execute(
        "SELECT status, repack_active FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
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

    # На переупаковке записи первого прохода неприкосновенны: они остаются оплаченным
    # фактом, а их товар уже возвращён в пул стартом переупаковки — сторно задвоило бы пул.
    if int(doc_row["repack_active"] or 0) and any(r["repack_kind"] is None for r in rows):
        raise HTTPException(
            status_code=400,
            detail="Задача на переупаковке: записи первой упаковки остаются оплаченными, отменять можно только записи переупаковки",
        )

    for r in rows:
        kind_ru = "брак" if str(r["to_quality"]) == INV_Q_DEFECT else "годный"
        label = r["product_sku"] or r["product_name"]
        qty = int(r["qty"] or 0)
        # Зеркалим зоны отменяемой записи: упаковка могла списать пул из ячейки, куда
        # его вручную переставили, — возврат кладёт товар обратно в ту же ячейку.
        insert_inventory_move(
            connection,
            product_id=str(r["product_id"]), product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=r["client_id"], client_name=r["client_name"],
            from_op=str(r["to_op"]), to_op=str(r["from_op"]),
            from_quality=str(r["to_quality"]), to_quality=str(r["from_quality"]),
            from_zone_id=r["to_zone_id"], from_zone_name=r["to_zone_name"],
            to_zone_id=r["from_zone_id"], to_zone_name=r["from_zone_name"],
            qty=qty, user_id=user_id, shipment_line_id=line_id,
            from_container_id=r["to_container_id"], to_container_id=r["from_container_id"],
            comment="Отмена записи упаковки",
            packed_date=r["packed_date"], pack_entry_id=str(uuid4()), reverses_id=entry_id,
            repack_kind=r["repack_kind"],
            repack_price_kop=int(r["repack_price_kop"]) if r["repack_price_kop"] is not None else None,
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
        f"""SELECT COALESCE(SUM(zr.qty), 0) AS moved
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0
             AND zr.from_op = '{INV_OP_STORAGE}' AND zr.to_op = '{INV_OP_PACKING}'""",
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
    суммы аллокаций должны точно покрыть весь ещё не размещённый упакованный годный и
    брак (корзина `packed`). Часть могла быть размещена раньше через `relocate_packed`
    (частичная отгрузка из упаковки) — её повторно раскладывать не нужно.
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

    total_moved = 0
    for line_id, line in by_id.items():
        pending = line_packed_pending(connection, line_id)
        good, defect = pending["good"], pending["defect"]
        li = inputs_by_id.get(line_id)
        good_allocs = [_relocate_alloc_zone(a) for a in (li.good if li else [])]
        defect_allocs = [_relocate_alloc_zone(a) for a in (li.defect if li else [])]

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

        total_moved += _emit_packed_placement(
            connection, line, client_id=client_id, packing_id=packing_id, packing_name=packing_name,
            good_allocs=good_allocs, defect_allocs=defect_allocs, user_id=user_id,
            comment_prefix="Перемещение к рейсу",
        )

        # Нерешённый пул (подвезли, но не упаковали) возвращаем на хранение,
        # чтобы товар не завис на упаковочном столе и баланс не утекал. Пул могли
        # вручную переставить по ячейкам — снимаем из фактических мест, товар
        # остаётся лежать там же (хранение в той же ячейке).
        leftover = line_on_packing_qty(connection, line_id)
        if leftover > 0:
            pool_sources = line_bucket_zone_sources(
                connection, line_id, op=INV_OP_PACKING, quality=INV_Q_GOOD, prefer_zone_id=packing_id,
            )
            for pool_zone_id, pool_zone_name, part in _consume_zone_sources(
                pool_sources, leftover, fallback=(packing_id, packing_name)
            ):
                insert_inventory_move(
                    connection,
                    product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                    color_id=line["color_id"], color_name=line["color_name"],
                    size_id=line["size_id"], size_name=line["size_name"],
                    client_id=client_id, client_name=None,
                    from_op=INV_OP_PACKING, to_op=INV_OP_STORAGE,
                    from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                    from_zone_id=pool_zone_id, from_zone_name=pool_zone_name,
                    to_zone_id=pool_zone_id, to_zone_name=pool_zone_name,
                    qty=part, user_id=user_id, shipment_line_id=line_id,
                    comment=f"Возврат нерешённого пула на хранение: {part} шт.",
                )

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
    _finalize_repack(connection, doc_id, user_id)
    connection.commit()
    return SHIPMENT_STATUS_PACKED


def relocate_packed(connection, doc_id: str, line_inputs, user_id: str) -> int:
    """Частичное размещение упакованного годного по местам ПРЯМО на упаковке.

    Большая задача упаковывается несколько дней; чтобы отгружать из уже упакованного, не
    дожидаясь конца, кладовщик размещает упакованный годный packed → ready по реальным
    местам — он становится «Готов к отгрузке» и доступен домену dispatch. Статус остаётся
    «На упаковке» (упаковка продолжается), нерешённый пул со стола НЕ трогаем. Брак на этом
    шаге не размещаем — он уезжает на хранение при финальном «Готово к рейсу».
    Гейт по строке: размещаемый годный не больше ещё не размещённого упакованного (`packed`).
    """
    from modules.balances.service import get_packing_zone

    doc = connection.execute(
        "SELECT status, cargo_type, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if normalize_cargo_type(doc["cargo_type"]) == SHIPMENT_CARGO_DEFECT:
        raise HTTPException(status_code=400, detail="Брак-отгрузка размещается одним шагом при подготовке")
    if str(doc["status"]) != SHIPMENT_STATUS_ON_PACKING:
        raise HTTPException(status_code=400, detail="Размещать готовое к отгрузке можно только в статусе «На упаковке»")

    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0", (doc_id,)
    ).fetchall()
    by_id = {str(l["id"]): l for l in lines}
    inputs_by_id = {str(li.line_id): li for li in (line_inputs or [])}

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc["client_id"]

    total_moved = 0
    for line_id, li in inputs_by_id.items():
        line = by_id.get(line_id)
        if not line:
            raise HTTPException(status_code=404, detail="Строка не найдена")
        good_allocs = [_relocate_alloc_zone(a) for a in (li.good or [])]
        if not good_allocs:
            continue
        pending_good = line_packed_pending(connection, line_id)["good"]
        if sum(q for *_, q in good_allocs) > pending_good:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Нельзя разместить больше упакованного для «{line['product_name']}» "
                    f"(упаковано и не размещено {pending_good} шт.)"
                ),
            )
        total_moved += _emit_packed_placement(
            connection, line, client_id=client_id, packing_id=packing_id, packing_name=packing_name,
            good_allocs=good_allocs, defect_allocs=[], user_id=user_id,
            comment_prefix="Размещено готового к отгрузке",
        )

    if total_moved <= 0:
        raise HTTPException(status_code=400, detail="Укажите, что и куда разместить")

    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_RELOCATE,
         f"Размещено готового к отгрузке: {total_moved} шт.", _now(), user_id),
    )
    connection.commit()
    return total_moved


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

    Документ можно аннулировать в статусах «В плане» и «На упаковке» (последний —
    только пока ничего не упаковано), когда товар уже частично передан в зону
    упаковки; без возврата он навсегда зависает в корзине «На упаковке» у
    аннулированного документа. Пул адресуется по строкам, поэтому **удалённые строки
    тоже разбираются**: состав правится в тех же статусах, что и передача, и у
    вычеркнутой строки пул иначе некому вернуть. Без commit — коммитит вызывающий.
    """
    doc = connection.execute(
        "SELECT client_id FROM shipment_docs WHERE id = ?", (doc_id,)
    ).fetchone()
    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ?", (doc_id,)
    ).fetchall()

    total_returned = 0
    for line in lines:
        total_returned += _return_line_packing_pool(
            connection, line, client_id=doc["client_id"] if doc else None, qty=None,
            user_id=user_id, comment_prefix="Возврат при аннулировании",
        )
    return total_returned


def _undo_relocation_to_packing(
    connection, doc_id: str, client_id, user_id: str, allow_partial: bool = False
) -> tuple[int, int]:
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
    При `allow_partial=True` вместо запрета возвращаем только физически доступный остаток
    (уже отгруженное с места ушло безвозвратно), а недостачу копим в `skipped` — это
    осознанный force-возврат, когда часть корректно уехала, а остаток надо переупаковать.
    Возвращает `(returned, skipped)`. Без commit — коммитит вызывающий.
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
    skipped = 0
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
                    if not allow_partial:
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                f"Нельзя вернуть на упаковку «{line['product_name']}»: "
                                f"часть товара уже отгружена или закреплена за рейсом "
                                f"(в месте «{zone_name or 'без места'}» доступно {avail}, нужно {qty}). "
                                "Сначала отмените отгрузку/рейс."
                            ),
                        )
                    skipped += qty - avail
                    qty = avail
                    if qty <= 0:
                        continue
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
    return total, skipped


def return_to_packing(connection, doc_id: str, user_id: str, force: bool = False) -> str:
    """Менеджерский возврат товарной задачи упаковки «на упаковку» (→ on_packing).

    Доступно из «Перемещение» и «Упаковано». Из «Перемещение» — чистая смена статуса
    (остатки между on_packing и relocating не двигались). Из «Упаковано» — сперва
    откатывается раскладка по местам (`_undo_relocation_to_packing`), восстанавливая
    состояние стола упаковки. «Дата упаковки (факт)» сбрасывается — её заново проставит
    следующая передача кладовщику. Брак упаковку минует — для брак-отгрузки запрещено.

    `force=True` — осознанный частичный возврат: если часть товара уже отгружена (ушла с
    места безвозвратно), возвращаем только остаток, а количество ушедшего фиксируем в
    журнале. Нужен, когда отгрузка корректна, но годное/брак по остатку размечены неверно.
    """
    doc = connection.execute(
        "SELECT status, cargo_type, task_kind, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if normalize_cargo_type(doc["cargo_type"]) == SHIPMENT_CARGO_DEFECT:
        raise HTTPException(status_code=400, detail="Брак-отгрузка минует упаковку — вернуть на упаковку нельзя")
    # Откат раскладки не знает оси короба: развезённый короб вернулся бы на стол
    # россыпью, а короб на бумаге остался бы полным.
    if normalize_task_kind(doc["task_kind"]) == SHIPMENT_TASK_PUTAWAY:
        raise HTTPException(status_code=400, detail="Для задачи «Упаковка с ТСД» возврат на упаковку пока недоступен")
    status = str(doc["status"])
    if status not in (SHIPMENT_STATUS_RELOCATING, SHIPMENT_STATUS_PACKED):
        raise HTTPException(status_code=400, detail="Вернуть на упаковку можно только из «Перемещение» или «Упаковано»")

    returned = 0
    skipped = 0
    if status == SHIPMENT_STATUS_PACKED:
        returned, skipped = _undo_relocation_to_packing(
            connection, doc_id, doc["client_id"], user_id, allow_partial=force
        )

    now = _now()
    connection.execute(
        "UPDATE shipment_docs SET status=?, actual_ship_date=NULL, updated_at=? WHERE id=?",
        (SHIPMENT_STATUS_ON_PACKING, now, doc_id),
    )
    if status == SHIPMENT_STATUS_PACKED:
        comment = f"Возврат на упаковку из «Упаковано»: раскладка откатана ({returned} шт.)"
        if skipped:
            comment += f"; {skipped} шт. уже отгружено — остались вне задачи"
    else:
        comment = "Возврат на упаковку из «Перемещение»"
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_RETURN_TO_PACKING, comment, now, user_id),
    )
    connection.commit()
    return SHIPMENT_STATUS_ON_PACKING


def _return_packed_good_to_pool(connection, doc_id: str, client_id, user_id: str) -> int:
    """Переупаковка: упакованный годный со стола («Упаковано») возвращается в пул упаковки.

    Пишет движение packed/good → packing/good БЕЗ pack_entry_id: факт упаковки документа
    обнуляется (кладовщик пакует заново, гейт плана пропустит), а pack-записи первого
    прохода не трогаются — производительность и заработок за прошлые дни сохраняются.
    Брак в пул не возвращается: он уже выявлен и переупаковке не подлежит. Без commit.
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move

    packing_id, packing_name = get_packing_zone(connection)
    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0", (doc_id,)
    ).fetchall()

    total = 0
    for line in lines:
        line_id = str(line["id"])
        pending = line_packed_pending(connection, line_id)["good"]
        if pending <= 0:
            continue
        label = line["product_sku"] or line["product_name"]
        sources = line_bucket_zone_sources(
            connection, line_id, op=INV_OP_PACKED, quality=INV_Q_GOOD, prefer_zone_id=packing_id,
        )
        for zone_id, zone_name, take in _consume_zone_sources(
            sources, pending, fallback=(packing_id, packing_name)
        ):
            insert_inventory_move(
                connection,
                product_id=str(line["product_id"]), product_name=line["product_name"], product_sku=line["product_sku"],
                color_id=line["color_id"], color_name=line["color_name"],
                size_id=line["size_id"], size_name=line["size_name"],
                client_id=client_id, client_name=None,
                from_op=INV_OP_PACKED, to_op=INV_OP_PACKING,
                from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                from_zone_id=zone_id, from_zone_name=zone_name,
                to_zone_id=packing_id, to_zone_name=packing_name,
                qty=take, user_id=user_id, shipment_line_id=line_id,
                comment=f"Переупаковка: возврат в пул упаковки {take} шт. — {label}",
            )
            total += take
    return total


def start_repack(
    connection, doc_id: str, user_id: str, *,
    kind: str, reason: str,
    unit_price_kop: int | None = None,
    extra_amount_kop: int | None = None,
    extra_comment: str | None = None,
    force: bool = False,
) -> str:
    """Менеджерский запуск переупаковки (задача была поставлена с ошибкой): → on_packing.

    Отличие от return_to_packing: упакованный годный возвращается в пул упаковки, и
    кладовщик пакует заново, при этом факт первого прохода остаётся оплаченным. Новые
    pack-записи штампуются видом переупаковки (см. record_packing):
      free — за наш счёт: объём виден в производительности, деньги 0;
      paid — за счёт клиента: при выходе задачи в «Упаковано» автоматически создаётся
             запись «Доп. работы» (кастомная цена за единицу либо стандартный тариф
             упаковки) плюс работы сверх тарифа (unit_price_kop/extra_*).
    """
    if kind not in SHIPMENT_REPACK_KINDS:
        raise HTTPException(status_code=400, detail="Неизвестный режим переупаковки")
    reason = str(reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите причину переупаковки")

    doc = connection.execute(
        "SELECT status, cargo_type, client_id FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if normalize_cargo_type(doc["cargo_type"]) == SHIPMENT_CARGO_DEFECT:
        raise HTTPException(status_code=400, detail="Брак-отгрузка минует упаковку — переупаковка недоступна")
    status = str(doc["status"])
    if status not in (SHIPMENT_STATUS_RELOCATING, SHIPMENT_STATUS_PACKED):
        raise HTTPException(status_code=400, detail="Переупаковку можно запустить только из «Перемещение» или «Упаковано»")

    if kind == SHIPMENT_REPACK_PAID:
        unit_price_kop = int(unit_price_kop) if unit_price_kop is not None else None
        if unit_price_kop is not None and unit_price_kop < 0:
            raise HTTPException(status_code=400, detail="Цена за единицу не может быть отрицательной")
        extra_amount_kop = int(extra_amount_kop or 0)
        if extra_amount_kop < 0:
            raise HTTPException(status_code=400, detail="Сумма доп. работ не может быть отрицательной")
        extra_comment = str(extra_comment or "").strip() or None
        if extra_amount_kop > 0 and not extra_comment:
            raise HTTPException(status_code=400, detail="Опишите, за что доп. работы (например: удаление старой упаковки)")
    else:
        unit_price_kop = None
        extra_amount_kop = 0
        extra_comment = None

    # Откат раскладки идемпотентен по нетто журнала: из «Упаковано» вернёт разложенное,
    # из «Перемещение» вернёт частичные размещения (place-packed), если они были.
    returned, skipped = _undo_relocation_to_packing(
        connection, doc_id, doc["client_id"], user_id, allow_partial=force
    )
    pooled = _return_packed_good_to_pool(connection, doc_id, doc["client_id"], user_id)

    now = _now()
    connection.execute(
        """UPDATE shipment_docs SET
             status = ?, actual_ship_date = NULL,
             repack_kind = ?, repack_reason = ?, repack_active = 1, repack_started_at = ?,
             repack_price_kop = ?, repack_extra_amount_kop = ?, repack_extra_comment = ?,
             updated_at = ?
           WHERE id = ?""",
        (SHIPMENT_STATUS_ON_PACKING, kind, reason, now,
         unit_price_kop, extra_amount_kop or None, extra_comment, now, doc_id),
    )

    from modules.expenses.service import format_kopecks

    kind_ru = "без оплаты" if kind == SHIPMENT_REPACK_FREE else "за счёт клиента"
    bits = [f"Переупаковка {kind_ru}: {reason}."]
    if pooled:
        bits.append(f"Возвращено в пул упаковки: {pooled} шт.")
    if skipped:
        bits.append(f"{skipped} шт. уже отгружено — остались вне задачи.")
    if kind == SHIPMENT_REPACK_PAID:
        bits.append(
            f"Тариф: {format_kopecks(unit_price_kop)}/шт." if unit_price_kop is not None
            else "Тариф: стандартный тариф упаковки."
        )
        if extra_amount_kop:
            bits.append(f"Доп. работы: {format_kopecks(extra_amount_kop)} ({extra_comment}).")
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_REPACK_START, " ".join(bits), now, user_id),
    )
    connection.commit()
    return SHIPMENT_STATUS_ON_PACKING


def _repack_category_id(connection, user_id: str) -> str:
    """Id вида работ «Переупаковка» в справочнике доп. работ (find-or-create)."""
    row = connection.execute(
        "SELECT id FROM extra_income_categories "
        "WHERE LOWER(TRIM(name)) = LOWER(?) AND COALESCE(is_deleted, 0) = 0",
        (EXTRA_INCOME_REPACK_CATEGORY_NAME,),
    ).fetchone()
    if row:
        return str(row["id"])
    new_id = str(uuid4())
    max_row = connection.execute(
        "SELECT COALESCE(MAX(sort_order), -1) AS m FROM extra_income_categories"
    ).fetchone()
    connection.execute(
        "INSERT INTO extra_income_categories (id,name,sort_order,created_at,created_by) VALUES (?,?,?,?,?)",
        (new_id, EXTRA_INCOME_REPACK_CATEGORY_NAME, int(max_row["m"]) + 1, _now(), user_id),
    )
    return new_id


def _finalize_repack(connection, doc_id: str, user_id: str) -> None:
    """Завершение переупаковки при выходе задачи в «Упаковано». Без commit.

    Снимает режим переупаковки. Для paid — автоматически создаёт запись «Доп. работы»
    (попадает в счёт привязкой и в P&L источником extra): Σ по pack-записям текущего
    цикла переупаковки × (кастомная цена за единицу | стандартный тариф упаковки на
    дату упаковки) + работы сверх тарифа. Если тариф не заведён — сумма по таким
    позициям 0 с предупреждением в журнале, финансист правит запись руками.
    """
    doc = connection.execute(
        "SELECT * FROM shipment_docs WHERE id = ? AND is_deleted = 0", (doc_id,)
    ).fetchone()
    if not doc or not int(doc["repack_active"] or 0):
        return
    now = _now()
    kind = str(doc["repack_kind"] or "")
    started_at = str(doc["repack_started_at"] or "")
    connection.execute(
        "UPDATE shipment_docs SET repack_active = 0, updated_at = ? WHERE id = ?", (now, doc_id)
    )

    # Объём текущего цикла: нетто по помеченным pack-записям, созданным после старта
    # (сторно наследует маркер и дату — вычитается автоматически).
    rows = connection.execute(
        f"""SELECT zr.product_id,
               COALESCE(NULLIF(TRIM(MIN(p.sku)), ''), MIN(zr.product_sku), MIN(zr.product_name)) AS label,
               zr.packed_date,
               {_PACKED_NET_SQL.format(p='zr.')}
           FROM zone_relocations zr
           JOIN shipment_lines l ON l.id = zr.shipment_line_id
           LEFT JOIN products p ON p.id = zr.product_id
           WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0
             AND zr.pack_entry_id IS NOT NULL AND zr.repack_kind = ? AND zr.created_at >= ?
           GROUP BY zr.product_id, zr.packed_date""",
        (doc_id, kind, started_at),
    ).fetchall()
    qty_total = sum(int(r["good"] or 0) + int(r["defect"] or 0) for r in rows)

    if kind != SHIPMENT_REPACK_PAID:
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_REPACK_CHARGE,
             f"Переупаковка завершена (без оплаты): {qty_total} шт. — клиенту не выставляется", now, user_id),
        )
        return

    from modules.expenses.service import format_kopecks
    from modules.extra_income.service import journal as extra_income_journal

    unit_price = int(doc["repack_price_kop"]) if doc["repack_price_kop"] is not None else None
    extra_amount = int(doc["repack_extra_amount_kop"] or 0)
    extra_comment = str(doc["repack_extra_comment"] or "").strip() or None

    tariff_amount = 0
    missing: list[str] = []
    if unit_price is not None:
        tariff_amount = qty_total * unit_price
    else:
        from modules.pricing.service import load_histories, price_on
        client_id = str(doc["client_id"]) if doc["client_id"] else None
        histories = load_histories(connection, [str(r["product_id"]) for r in rows])
        for r in rows:
            for quality, qty in ((INV_Q_GOOD, int(r["good"] or 0)), (INV_Q_DEFECT, int(r["defect"] or 0))):
                if qty <= 0 or not client_id:
                    continue
                price = price_on(histories.get((str(r["product_id"]), client_id, quality)), str(r["packed_date"]))
                if price is None:
                    if str(r["label"]) not in missing:
                        missing.append(str(r["label"]))
                else:
                    tariff_amount += price * qty
    total_amount = tariff_amount + extra_amount

    if qty_total <= 0 and total_amount <= 0:
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_REPACK_CHARGE,
             "Переупаковка завершена: повторной упаковки не было, доп. работа не создана", now, user_id),
        )
        return
    if not doc["client_id"]:
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_REPACK_CHARGE,
             "Переупаковка завершена, но в задаче не указан клиент — создайте доп. работу вручную", now, user_id),
        )
        return

    entry_id = str(uuid4())
    comment_bits = [f"Переупаковка по вине клиента, задача {doc['doc_number']}: {doc['repack_reason']}"]
    comment_bits.append(
        f"Тариф: {qty_total} шт. × {format_kopecks(unit_price)}" if unit_price is not None
        else "По стандартному тарифу упаковки"
    )
    if extra_amount:
        comment_bits.append(f"Доп. работы: {format_kopecks(extra_amount)}" + (f" — {extra_comment}" if extra_comment else ""))
    if missing:
        comment_bits.append("Тариф не заведён: " + ", ".join(missing) + " — сумма по ним не учтена, проверьте")
    connection.execute(
        """INSERT INTO extra_income_entries
           (id,entry_date,client_id,category_id,qty,amount_kop,comment,created_at,created_by)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (entry_id, business_today().isoformat(), str(doc["client_id"]),
         _repack_category_id(connection, user_id), qty_total or None, total_amount,
         ". ".join(comment_bits), now, user_id),
    )
    extra_income_journal(
        connection, entry_id, EXTRA_INCOME_OP_CREATE,
        f"Заведено автоматически: переупаковка по задаче {doc['doc_number']} · {format_kopecks(total_amount)}",
        user_id,
    )
    connection.execute(
        "UPDATE shipment_docs SET repack_charge_entry_id = ?, updated_at = ? WHERE id = ?",
        (entry_id, now, doc_id),
    )
    op_comment = f"Переупаковка выставлена клиенту: {qty_total} шт. · {format_kopecks(total_amount)} (доп. работа создана)"
    if missing:
        op_comment += ". Тариф упаковки не заведён: " + ", ".join(missing) + " — проверьте сумму доп. работы"
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_REPACK_CHARGE, op_comment, now, user_id),
    )


def advance_shipment(connection, doc_id: str, user_id: str, user_role: str) -> str:
    """Переводит документ на следующий статус с ролевым гейтом и проверками фазы.

    Годный груз: draft → packing (Поставить задачу) · packing → on_packing (Передать
    на упаковку) · on_packing → relocating (Передать кладовщику). relocating →
    packed («Готово») делает отдельный эндпоинт finish_relocation.
    Брак-отгрузка минует упаковку: draft → relocating (Запланировать — задача
    кладовщику подготовить брак); relocating → packed делает
    finish_defect_relocation. Отгрузку к рейсу далее возит домен dispatch.
    """
    row = connection.execute(
        "SELECT status, comment, client_id, cargo_type, task_kind, ship_date "
        "FROM shipment_docs WHERE id = ? AND is_deleted = 0",
        (doc_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")

    is_defect_cargo = normalize_cargo_type(row["cargo_type"]) == SHIPMENT_CARGO_DEFECT
    is_putaway = normalize_task_kind(row["task_kind"]) == SHIPMENT_TASK_PUTAWAY
    if is_putaway:
        # Упаковка с ТСД: on_packing → packed делает finish_collecting.
        transitions, roles = SHIPMENT_TRANSITIONS_PUTAWAY, SHIPMENT_TRANSITION_ROLES_PUTAWAY
    elif is_defect_cargo:
        transitions, roles = SHIPMENT_TRANSITIONS_DEFECT, SHIPMENT_TRANSITION_ROLES_DEFECT
    else:
        transitions, roles = SHIPMENT_TRANSITIONS, SHIPMENT_TRANSITION_ROLES

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
    elif next_status == SHIPMENT_STATUS_PACKING:
        if not str(row["ship_date"] or "").strip():
            raise HTTPException(
                status_code=400,
                detail="Укажите дату упаковки (план)",
            )
        if not is_putaway and not str(row["comment"] or "").strip():
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
            (next_status, business_today().isoformat(), now, doc_id),
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


# ── Распознавание ШК на файлах строк ──────────────────────────────────────────

_barcode_log = logging.getLogger("wms.shipments.barcode")

# Масштабы рендера PDF (1.0 = 72 dpi). Мелкая этикетка 43×25 мм на 216 dpi даёт
# около 2 px на модуль — плотный Code128 на грани читаемости, поэтому при пустом
# результате страница перерисовывается крупнее.
_PDF_RENDER_SCALES = (3, 6)


def _read_barcodes(images, formats) -> list[str]:
    import zxingcpp

    codes: list[str] = []
    for img in images:
        for result in zxingcpp.read_barcodes(img, formats=formats):
            text = (result.text or "").strip()
            if text and text not in codes:
                codes.append(text)
    return codes


def decode_line_file_barcodes(data: bytes, ext: str) -> list[str]:
    """Товарные штрих-коды (EAN/UPC/Code128) с картинки или PDF-этикетки.

    Возвращает уникальные коды в порядке обнаружения; QR и служебные символогии
    отбрасываются. Любая ошибка декодирования — пустой список: распознавание не
    должно блокировать загрузку файла.
    """
    try:
        import io

        import zxingcpp
        from PIL import Image, ImageOps

        # OR-комбинация, а не список: список принимает только zxing-cpp ≥ 3.0.
        formats = (
            zxingcpp.BarcodeFormat.EAN13
            | zxingcpp.BarcodeFormat.EAN8
            | zxingcpp.BarcodeFormat.UPCA
            | zxingcpp.BarcodeFormat.UPCE
            | zxingcpp.BarcodeFormat.Code128
        )

        if ext == ".pdf":
            import pypdfium2 as pdfium

            pdf = pdfium.PdfDocument(data)
            try:
                # Первые страницы: этикетка — 1 страница, защита от тяжёлых PDF.
                pages = [pdf[i] for i in range(min(len(pdf), 3))]
                for scale in _PDF_RENDER_SCALES:
                    codes = _read_barcodes([p.render(scale=scale).to_pil() for p in pages], formats)
                    if codes:
                        return codes
                return []
            finally:
                pdf.close()

        # exif_transpose — фото с телефона приходят с ориентацией в EXIF.
        return _read_barcodes([ImageOps.exif_transpose(Image.open(io.BytesIO(data)))], formats)
    except Exception:
        _barcode_log.warning("Не удалось распознать ШК на файле (%s)", ext, exc_info=True)
        return []


def resolve_line_variant_id(connection, product_id: str, color_id, size_id) -> str | None:
    """Вариант строки документа по тройке товар+цвет+размер (строки хранят её, не variant_id)."""
    row = connection.execute(
        "SELECT id FROM product_variants "
        "WHERE product_id = ? AND color_id IS NOT DISTINCT FROM ?::text "
        "  AND size_id IS NOT DISTINCT FROM ?::text AND COALESCE(is_deleted, 0) = 0 "
        "LIMIT 1",
        (product_id, color_id, size_id),
    ).fetchone()
    return str(row["id"]) if row else None


def line_store_barcodes(connection, doc_id: str) -> dict[str, list[str]]:
    """Строка задачи → ШК её варианта, заведённые под магазин строки."""
    rows = connection.execute(
        """
        SELECT l.id AS line_id, pb.barcode
        FROM shipment_lines l
        JOIN product_variants v ON v.product_id = l.product_id
         AND v.color_id IS NOT DISTINCT FROM l.color_id
         AND v.size_id IS NOT DISTINCT FROM l.size_id
         AND COALESCE(v.is_deleted, 0) = 0
        JOIN product_barcodes pb ON pb.variant_id = v.id
         AND COALESCE(pb.is_deleted, 0) = 0
         AND pb.store_id = l.store_id
        WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0 AND l.store_id IS NOT NULL
        ORDER BY pb.barcode
        """,
        (doc_id,),
    ).fetchall()
    out: dict[str, list[str]] = {}
    for row in rows:
        out.setdefault(str(row["line_id"]), []).append(str(row["barcode"]))
    return out


def store_barcode_items(connection, doc_id: str) -> list[dict]:
    """Позиции задачи для подтягивания ШК из кабинета магазина (см. marketplaces)."""
    rows = connection.execute(
        """
        SELECT l.id, l.product_id, l.store_id, l.color_id, l.size_id,
               COALESCE(NULLIF(p.name, ''), '') AS product_name,
               COALESCE(NULLIF(p.sku, ''), NULLIF(l.product_sku, ''), '') AS product_sku,
               col.name AS color_name, sz.name AS size_name,
               v.id AS variant_id
        FROM shipment_lines l
        LEFT JOIN products p ON p.id = l.product_id
        LEFT JOIN colors col ON col.id = l.color_id
        LEFT JOIN sizes sz ON sz.id = l.size_id
        LEFT JOIN product_variants v ON v.product_id = l.product_id
         AND v.color_id IS NOT DISTINCT FROM l.color_id
         AND v.size_id IS NOT DISTINCT FROM l.size_id
         AND COALESCE(v.is_deleted, 0) = 0
        WHERE l.doc_id = ? AND COALESCE(l.is_deleted, 0) = 0
        ORDER BY l.created_at, l.id
        """,
        (doc_id,),
    ).fetchall()
    return [
        {
            "key": str(r["id"]),
            "store_id": r["store_id"],
            "product_id": str(r["product_id"]),
            "variant_id": r["variant_id"],
            "product_name": str(r["product_name"] or ""),
            "product_sku": str(r["product_sku"] or ""),
            "color_name": r["color_name"],
            "size_name": r["size_name"],
        }
        for r in rows
    ]


def store_barcode_items_for_lines(connection, lines: list[dict]) -> list[dict]:
    """То же, что store_barcode_items, но состав ещё не сохранён (форма создания).

    С клиента приходят только id (товар, цвет, размер, магазин) — название, SKU и
    вариант резолвятся здесь по БД, как и для строк документа."""
    out: list[dict] = []
    for line in lines:
        product_id = str(line.get("product_id") or "")
        if not product_id:
            continue
        row = connection.execute(
            """
            SELECT COALESCE(NULLIF(p.name, ''), '') AS product_name,
                   COALESCE(NULLIF(p.sku, ''), '') AS product_sku,
                   col.name AS color_name, sz.name AS size_name,
                   v.id AS variant_id
            FROM products p
            LEFT JOIN colors col ON col.id = ?
            LEFT JOIN sizes sz ON sz.id = ?
            LEFT JOIN product_variants v ON v.product_id = p.id
             AND v.color_id IS NOT DISTINCT FROM ?
             AND v.size_id IS NOT DISTINCT FROM ?
             AND COALESCE(v.is_deleted, 0) = 0
            WHERE p.id = ? AND COALESCE(p.is_deleted, 0) = 0
            """,
            (line.get("color_id"), line.get("size_id"),
             line.get("color_id"), line.get("size_id"), product_id),
        ).fetchone()
        if not row:
            continue
        out.append({
            "key": str(line["key"]),
            "store_id": line.get("store_id") or None,
            "product_id": product_id,
            "variant_id": row["variant_id"],
            "product_name": str(row["product_name"] or ""),
            "product_sku": str(row["product_sku"] or ""),
            "color_name": row["color_name"],
            "size_name": row["size_name"],
        })
    return out


def classify_barcodes_for_variant(connection, codes: list[str], *, product_id: str, variant_id: str | None) -> list[dict]:
    """Статус каждого распознанного кода относительно варианта строки:
    confirmed — привязан к этому варианту; other_variant — другой цвет/размер того же
    товара (вероятный пересорт); other_product — чужой товар; unknown — в системе нет."""
    out: list[dict] = []
    for code in codes:
        row = connection.execute(
            """
            SELECT pb.product_id, pb.variant_id, p.name AS product_name,
                   col.name AS color_name, sz.name AS size_name
            FROM product_barcodes pb
            JOIN products p ON p.id = pb.product_id
            LEFT JOIN product_variants v ON v.id = pb.variant_id
            LEFT JOIN colors col ON col.id = v.color_id
            LEFT JOIN sizes sz ON sz.id = v.size_id
            WHERE pb.barcode = ? AND COALESCE(pb.is_deleted, 0) = 0
            LIMIT 1
            """,
            (code,),
        ).fetchone()
        item = {"code": code, "status": "unknown", "other_product_name": None, "other_variant_label": None}
        if row is not None:
            variant_label = " · ".join(x for x in (row["color_name"], row["size_name"]) if x)
            if str(row["product_id"]) != product_id:
                item["status"] = "other_product"
                item["other_product_name"] = str(row["product_name"])
                item["other_variant_label"] = variant_label or None
            elif variant_id is not None and row["variant_id"] and str(row["variant_id"]) != variant_id:
                item["status"] = "other_variant"
                item["other_variant_label"] = variant_label or "другой вариант"
            else:
                item["status"] = "confirmed"
        out.append(item)
    return out


# ── Задача «Упаковка с ТСД»: короба и сборка ──────────────────────────────────

def _require_putaway_doc(connection, doc_id: str, *, status: str | None = SHIPMENT_STATUS_ON_PACKING):
    """Задача с ТСД в рабочем статусе. 404/400 с русским detail."""
    doc = connection.execute(
        "SELECT id, doc_number, status, client_id, client_name, task_kind "
        "FROM shipment_docs WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (doc_id,),
    ).fetchone()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if normalize_task_kind(doc["task_kind"]) != SHIPMENT_TASK_PUTAWAY:
        raise HTTPException(status_code=400, detail="Короба собираются только в задаче «Упаковка с ТСД»")
    if status and str(doc["status"]) != status:
        raise HTTPException(
            status_code=400,
            detail=f"Собирать короба можно только в статусе «{SHIPMENT_STATUS_LABELS[status]}»",
        )
    return doc


def _task_store(connection, doc_id: str) -> tuple[str | None, str | None]:
    """Магазин задачи, если он у всех строк один — короб принадлежит одному магазину."""
    rows = connection.execute(
        "SELECT DISTINCT store_id, store_name FROM shipment_lines "
        "WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 AND store_id IS NOT NULL",
        (doc_id,),
    ).fetchall()
    if len(rows) == 1:
        return str(rows[0]["store_id"]), rows[0]["store_name"]
    return None, None


def _box_label(row) -> str:
    return str(row["doc_number"])


def line_boxed_qty(connection, line_id: str) -> int:
    """Сколько по строке упаковано сканом и ещё стоит у стола (нетто корзины packed).

    Считает и короба, и россыпь без короба: короб — просто тара, ось контейнера
    на доступность товара не влияет.
    """
    pending = line_packed_pending(connection, line_id)
    return pending["good"] + pending["defect"]


def line_boxed_defect_qty(connection, line_id: str) -> int:
    """Из стоящего у стола — брак (для карточки задачи и ТСД)."""
    return line_packed_pending(connection, line_id)["defect"]


def line_aside_defect_qty(connection, line_id: str) -> int:
    """Из собранного без короба — брак: ему обычно нужно своё место."""
    row = connection.execute(
        f"""SELECT
              COALESCE(SUM(CASE WHEN to_op = '{INV_OP_PACKED}' AND to_container_id IS NULL
                                 AND to_quality = '{INV_Q_DEFECT}' THEN qty ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN from_op = '{INV_OP_PACKED}' AND from_container_id IS NULL
                                 AND from_quality = '{INV_Q_DEFECT}' THEN qty ELSE 0 END), 0) AS qty
           FROM zone_relocations WHERE shipment_line_id = ?""",
        (line_id,),
    ).fetchone()
    return int(row["qty"] or 0)


def line_aside_qty(connection, line_id: str) -> int:
    """Из стоящего у стола — то, что собрано без короба (габарит, брак).

    Отличается осью короба: у россыпи `*_container_id` пуст, поэтому она уезжает в
    зону отгрузки отдельным сканом товара, а не сканом короба.
    """
    row = connection.execute(
        f"""SELECT
              COALESCE(SUM(CASE WHEN to_op = '{INV_OP_PACKED}' AND to_container_id IS NULL THEN qty ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN from_op = '{INV_OP_PACKED}' AND from_container_id IS NULL THEN qty ELSE 0 END), 0) AS qty
           FROM zone_relocations WHERE shipment_line_id = ?""",
        (line_id,),
    ).fetchone()
    return int(row["qty"] or 0)


# Движение «развезено по заданию»: упакованное уехало со стола в зону отгрузки
# (packed → ready) коробом или россыпью. Обратное движение — сторно ошибочной развозки.
_PLACED_IN_SQL  = f"from_op = '{INV_OP_PACKED}' AND to_op = '{INV_OP_READY}'"
_PLACED_OUT_SQL = f"from_op = '{INV_OP_READY}' AND to_op = '{INV_OP_PACKED}'"


def line_placed_qty(connection, line_id: str) -> int:
    """Сколько по строке уже уехало в места хранения: коробами и россыпью.

    Нетто: возврат из места хранения обратно в сборку размещённое уменьшает.
    """
    row = connection.execute(
        f"""SELECT
              COALESCE(SUM(CASE WHEN {_PLACED_IN_SQL}  THEN qty ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN {_PLACED_OUT_SQL} THEN qty ELSE 0 END), 0) AS qty
           FROM zone_relocations WHERE shipment_line_id = ?""",
        (line_id,),
    ).fetchone()
    return int(row["qty"] or 0)


def box_detail(connection, container_id: str) -> dict:
    """Короб + содержимое одной структурой (ответ всех операций ТСД)."""
    from modules.containers.service import container_contents, container_quality, containers_items_qty

    row = connection.execute(
        "SELECT id, doc_number, status, zone_id, zone_name, created_at, closed_at, placed_at "
        "FROM containers WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (container_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Короб не найден")
    return {
        "id": str(row["id"]),
        "doc_number": str(row["doc_number"]),
        "status": str(row["status"]),
        "zone_id": row["zone_id"],
        "zone_name": row["zone_name"],
        "items_qty": containers_items_qty(connection, [container_id]).get(container_id, 0),
        "quality": container_quality(connection, container_id),
        "contents": [c.model_dump() for c in container_contents(connection, container_id)],
        "created_at": str(row["created_at"]),
        "closed_at": row["closed_at"],
        "placed_at": row["placed_at"],
    }


def list_task_boxes(connection, doc_id: str) -> list[dict]:
    """Короба задачи размещения с содержимым — для карточки и ТСД."""
    rows = connection.execute(
        "SELECT id FROM containers WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 ORDER BY doc_number",
        (doc_id,),
    ).fetchall()
    return [box_detail(connection, str(r["id"])) for r in rows]


def take_box(connection, doc_id: str, code: str, user_id: str) -> dict:
    """Скан этикетки короба: свободный короб берётся в задачу, свой — открывается.

    Короб принадлежит одному клиенту (и магазину, если он у задачи один) — иначе
    содержимое короба нельзя однозначно отнести к клиенту при хранении и отборе.
    """
    from modules.containers.service import log_container_op, lookup_container

    doc = _require_putaway_doc(connection, doc_id)
    found = lookup_container(connection, code)
    if not found.found or not found.container:
        raise HTTPException(
            status_code=404,
            detail=f"Короб «{code}» не найден — напечатайте этикетку в системе",
        )
    box = connection.execute(
        "SELECT * FROM containers WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (found.container.id,),
    ).fetchone()
    status = str(box["status"])
    box_doc_id = str(box["doc_id"]) if box["doc_id"] else None
    label = _box_label(box)

    if status == CONTAINER_STATUS_PLACED:
        raise HTTPException(
            status_code=400,
            detail=f"Короб {label} уже размещён в ячейке {box['zone_name'] or '—'}",
        )
    if box_doc_id and box_doc_id != str(doc_id):
        other = connection.execute(
            "SELECT doc_number FROM shipment_docs WHERE id = ?", (box_doc_id,)
        ).fetchone()
        raise HTTPException(
            status_code=400,
            detail=f"Короб {label} занят задачей {other['doc_number'] if other else box_doc_id}",
        )
    if status == CONTAINER_STATUS_CLOSED:
        raise HTTPException(
            status_code=400,
            detail=f"Короб {label} закрыт — отнесите его в ячейку или откройте заново",
        )

    if status == CONTAINER_STATUS_NEW:
        now = _now()
        store_id, store_name = _task_store(connection, doc_id)
        connection.execute(
            "UPDATE containers SET status = ?, doc_id = ?, client_id = ?, client_name = ?, "
            "store_id = ?, store_name = ?, updated_at = ? WHERE id = ?",
            (CONTAINER_STATUS_OPEN, doc_id, doc["client_id"], doc["client_name"],
             store_id, store_name, now, str(box["id"])),
        )
        log_container_op(
            connection, container_id=str(box["id"]), op_type=CONTAINER_OP_TAKE, user_id=user_id,
            doc_id=doc_id, comment=f"Взят в задачу {doc['doc_number']}",
        )
        connection.execute(
            "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
            (str(uuid4()), doc_id, SHIPMENT_OP_BOX_TAKE, f"Короб {label} взят в работу", now, user_id),
        )
    return box_detail(connection, str(box["id"]))


def _require_task_box(connection, doc_id: str, container_id: str, *, status: str | None = None):
    box = connection.execute(
        "SELECT * FROM containers WHERE id = ? AND COALESCE(is_deleted, 0) = 0", (container_id,)
    ).fetchone()
    if not box:
        raise HTTPException(status_code=404, detail="Короб не найден")
    if str(box["doc_id"] or "") != str(doc_id):
        raise HTTPException(status_code=400, detail=f"Короб {_box_label(box)} не относится к этой задаче")
    if status and str(box["status"]) != status:
        detail = {
            CONTAINER_STATUS_OPEN: f"Короб {_box_label(box)} уже закрыт",
            CONTAINER_STATUS_CLOSED: f"Короб {_box_label(box)} ещё не закрыт",
            CONTAINER_STATUS_PLACED: f"Короб {_box_label(box)} ещё не размещён",
        }[status]
        raise HTTPException(status_code=400, detail=detail)
    return box


def variant_by_barcode(connection, code: str) -> dict:
    """ШК → вариант товара. 404, если код не заведён (ручного выбора товара нет)."""
    bc = (code or "").strip()
    row = connection.execute(
        """SELECT p.id AS product_id, v.color_id, v.size_id
           FROM product_barcodes pb
           JOIN product_variants v ON v.id = pb.variant_id
           JOIN products p ON p.id = pb.product_id
           WHERE pb.barcode = ?
             AND COALESCE(pb.is_deleted, 0) = 0
             AND COALESCE(v.is_deleted, 0) = 0
             AND COALESCE(p.is_deleted, 0) = 0
           LIMIT 1""",
        (bc,),
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"Штрих-код «{bc}» не найден — заведите его в карточке товара",
        )
    return {"product_id": str(row["product_id"]), "color_id": row["color_id"], "size_id": row["size_id"]}


def _line_for_variant(connection, doc_id: str, variant: dict, *, prefer_boxable: bool = False):
    """Строка задания под отсканированный вариант: первая, где план ещё не закрыт.

    Один вариант может стоять в задании несколькими строками (разные магазины) —
    добираем ту, где остался незакрытый план, иначе скан упирался бы в первую.
    prefer_boxable — для скана в короб: сначала строка, у которой есть товар на столе
    упаковки, иначе скан уткнулся бы в строку, товар которой ещё не подвезли.
    """
    rows = connection.execute(
        """SELECT * FROM shipment_lines
           WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0
             AND product_id = ?
             AND color_id IS NOT DISTINCT FROM ?::text
             AND size_id  IS NOT DISTINCT FROM ?::text
           ORDER BY created_at""",
        (doc_id, variant["product_id"], variant["color_id"], variant["size_id"]),
    ).fetchall()
    if not rows:
        raise HTTPException(status_code=400, detail="Товара нет в задании")
    if prefer_boxable:
        for r in rows:
            if line_on_packing_qty(connection, str(r["id"])) > 0:
                return r
    for r in rows:
        if line_packed_breakdown(connection, str(r["id"]))["good"] < int(r["qty"] or 0):
            return r
    return rows[0]


def _normalize_quality(value: str | None) -> str:
    """Качество скана ТСД: годный по умолчанию, брак — явным переключателем."""
    q = (value or INV_Q_GOOD).strip()
    if q not in (INV_Q_GOOD, INV_Q_DEFECT):
        raise HTTPException(status_code=400, detail="Укажите качество: годный или брак")
    return q


def add_box_item(
    connection, doc_id: str, container_id: str, *,
    barcode: str, qty: int, user_id: str, quality: str = INV_Q_GOOD,
) -> dict:
    """Скан товара на ТСД: единица упаковывается и сразу ложится в короб.

    Упаковка в этой задаче идёт поштучно в процессе сборки, поэтому скан пишет обычную
    запись упаковки (объём, дата, заработок), а товар уходит не на стол «Упаковано», а
    в корзину короба. Короб набирается однородно: либо годный, либо брак — смешанный
    короб пришлось бы разбирать на месте хранения, а брак ещё и уезжает отдельно.
    Гейты — от record_packing: годного не больше плана строки и не больше того,
    что физически передано на стол упаковки.
    """
    from modules.containers.service import container_quality, log_container_op

    _require_putaway_doc(connection, doc_id)
    box = _require_task_box(connection, doc_id, container_id, status=CONTAINER_STATUS_OPEN)
    n = int(qty or 0)
    if n <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество больше нуля")
    q = _normalize_quality(quality)

    box_q = container_quality(connection, container_id)
    if box_q is not None and box_q != q:
        filled_ru = "браком" if box_q == INV_Q_DEFECT else "годным" if box_q == INV_Q_GOOD else "смешанно"
        scan_ru = "брак" if q == INV_Q_DEFECT else "годный"
        raise HTTPException(
            status_code=400,
            detail=f"Короб {_box_label(box)} набран {filled_ru} — {scan_ru} кладите в другой короб",
        )

    variant = variant_by_barcode(connection, barcode)
    line = _line_for_variant(connection, doc_id, variant, prefer_boxable=True)
    is_defect = q == INV_Q_DEFECT
    record_packing(
        connection, doc_id, str(line["id"]),
        good_delta=0 if is_defect else n, defect_delta=n if is_defect else 0,
        packed_date=business_today().isoformat(),
        user_id=user_id,
        container_id=container_id,
    )
    log_container_op(
        connection, container_id=container_id, op_type=CONTAINER_OP_ITEM_ADD, user_id=user_id,
        doc_id=doc_id, product_id=str(line["product_id"]), product_name=line["product_name"],
        product_sku=line["product_sku"], color_name=line["color_name"], size_name=line["size_name"],
        qty=n, comment=f"+{n} шт." + (" (брак)" if is_defect else ""),
    )
    return box_detail(connection, container_id)


def _reverse_pack_entries(
    connection, doc_id: str, line_id: str, qty: int, user_id: str, *,
    leg_sql: str, leg_params: tuple, empty_detail: str,
) -> list[dict]:
    """Сторно записей упаковки строки от новых к старым, пока не наберётся `qty`.

    Каждый скан ТСД — отдельная запись упаковки, поэтому отмена ошибки обязана её
    сторнировать (иначе объём и заработок остались бы за товар, которого нет на месте).
    Записи отменяются целиком: частичной отмены записи в модели нет. `leg_sql` выбирает
    ровно одно движение записи (короб / прямое размещение / брак) — иначе SUM задвоил
    бы количество на записях с двумя движениями. Возвращает отменённые позиции: свой
    журнал вызывающий пишет сам.
    """
    n = int(qty or 0)
    if n <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество больше нуля")

    rows = connection.execute(
        f"""SELECT zr.pack_entry_id, SUM(zr.qty) AS qty,
                  MIN(zr.product_name) AS product_name, MIN(zr.product_sku) AS product_sku,
                  MIN(zr.color_name) AS color_name, MIN(zr.size_name) AS size_name,
                  MIN(zr.product_id) AS product_id, MAX(zr.created_at) AS created_at
           FROM zone_relocations zr
           WHERE zr.shipment_line_id = ? AND ({leg_sql})
             AND zr.pack_entry_id IS NOT NULL AND zr.reverses_id IS NULL
             AND NOT EXISTS (
                 SELECT 1 FROM zone_relocations rev WHERE rev.reverses_id = zr.pack_entry_id
             )
           GROUP BY zr.pack_entry_id
           ORDER BY MAX(zr.created_at) DESC""",
        (line_id, *leg_params),
    ).fetchall()
    if not rows:
        raise HTTPException(status_code=400, detail=empty_detail)

    undone: list[dict] = []
    removed = 0
    for r in rows:
        entry_qty = int(r["qty"] or 0)
        if removed + entry_qty > n:
            continue
        reverse_packing_entry(connection, doc_id, str(line_id), str(r["pack_entry_id"]), user_id)
        undone.append({
            "product_id": str(r["product_id"]), "product_name": r["product_name"],
            "product_sku": r["product_sku"], "color_name": r["color_name"],
            "size_name": r["size_name"], "qty": entry_qty,
        })
        removed += entry_qty
        if removed >= n:
            break
    if removed == 0:
        raise HTTPException(
            status_code=400,
            detail=f"Записи упаковки крупнее запрошенного ({int(rows[0]['qty'])} шт.) — изымите их целиком",
        )
    return undone


def undo_box_item(connection, doc_id: str, container_id: str, line_id: str, qty: int, user_id: str) -> dict:
    """Изъятие из открытого короба: товар возвращается в пул на столе упаковки.

    Отменяются записи от новых к старым независимо от качества — на ТСД изымают
    «последнее, что положили», а не «последний годный».
    """
    from modules.containers.service import log_container_op

    _require_putaway_doc(connection, doc_id)
    _require_task_box(connection, doc_id, container_id, status=CONTAINER_STATUS_OPEN)
    undone = _reverse_pack_entries(
        connection, doc_id, line_id, qty, user_id,
        leg_sql="zr.to_container_id = ?", leg_params=(container_id,),
        empty_detail="В коробе нет этой позиции",
    )
    for r in undone:
        log_container_op(
            connection, container_id=container_id, op_type=CONTAINER_OP_ITEM_REMOVE, user_id=user_id,
            doc_id=doc_id, product_id=r["product_id"], product_name=r["product_name"],
            product_sku=r["product_sku"], color_name=r["color_name"], size_name=r["size_name"],
            qty=r["qty"], comment=f"Изъятие из короба: −{r['qty']} шт.",
        )
    return box_detail(connection, container_id)


def close_box(connection, doc_id: str, container_id: str, user_id: str) -> dict:
    """Короб закрыт и заклеен: дальше его можно только разместить или открыть заново."""
    from modules.containers.service import containers_items_qty, log_container_op

    _require_putaway_doc(connection, doc_id)
    box = _require_task_box(connection, doc_id, container_id, status=CONTAINER_STATUS_OPEN)
    if containers_items_qty(connection, [container_id]).get(container_id, 0) <= 0:
        raise HTTPException(status_code=400, detail="Короб пустой — положите товар перед закрытием")

    now = _now()
    connection.execute(
        "UPDATE containers SET status = ?, closed_at = ?, updated_at = ? WHERE id = ?",
        (CONTAINER_STATUS_CLOSED, now, now, container_id),
    )
    log_container_op(
        connection, container_id=container_id, op_type=CONTAINER_OP_CLOSE, user_id=user_id,
        doc_id=doc_id, comment="Короб закрыт",
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_BOX_CLOSE, f"Короб {_box_label(box)} закрыт", now, user_id),
    )
    return box_detail(connection, container_id)


def reopen_box(connection, doc_id: str, container_id: str, user_id: str) -> dict:
    """Открыть закрытый (но ещё не размещённый) короб — доложить или исправить."""
    from modules.containers.service import log_container_op

    _require_putaway_doc(connection, doc_id)
    _require_task_box(connection, doc_id, container_id, status=CONTAINER_STATUS_CLOSED)
    connection.execute(
        "UPDATE containers SET status = ?, closed_at = NULL, updated_at = ? WHERE id = ?",
        (CONTAINER_STATUS_OPEN, _now(), container_id),
    )
    log_container_op(
        connection, container_id=container_id, op_type=CONTAINER_OP_REOPEN, user_id=user_id,
        doc_id=doc_id, comment="Короб открыт заново",
    )
    return box_detail(connection, container_id)


def _release_empty_box(connection, doc_id: str, box, user_id: str) -> None:
    """Пустой короб уходит обратно в свободный пул (`new`), а не удаляется.

    Этикетка наклеена на реальную коробку — её номер должен остаться живым и снова
    браться сканом в любую задачу.
    """
    from modules.containers.service import log_container_op

    now = _now()
    connection.execute(
        "UPDATE containers SET status = ?, doc_id = NULL, client_id = NULL, client_name = NULL, "
        "store_id = NULL, store_name = NULL, closed_at = NULL, updated_at = ? WHERE id = ?",
        (CONTAINER_STATUS_NEW, now, str(box["id"])),
    )
    log_container_op(
        connection, container_id=str(box["id"]), op_type=CONTAINER_OP_RELEASE, user_id=user_id,
        doc_id=doc_id, comment="Пустой короб снят с задачи",
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_BOX_RELEASE,
         f"Короб {_box_label(box)} снят с задачи (пустой)", now, user_id),
    )


def release_box(connection, doc_id: str, container_id: str, user_id: str) -> dict:
    """«Освободить короб»: этикетку взяли по ошибке, товара в коробе нет.

    Без этого ошибочно взятый короб намертво держит задачу: закрыть пустой короб
    нельзя, а гейт финиша ждёт, пока все короба размещены.
    """
    from modules.containers.service import containers_items_qty

    _require_putaway_doc(connection, doc_id)
    box = _require_task_box(connection, doc_id, container_id, status=CONTAINER_STATUS_OPEN)
    in_box = containers_items_qty(connection, [container_id]).get(container_id, 0)
    if in_box > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Короб {_box_label(box)} не пустой ({in_box} шт.) — сначала изымите товар",
        )
    _release_empty_box(connection, doc_id, box, user_id)
    return {"message": "ok"}


def _aside_total(connection, doc_id: str) -> int:
    """Собранное мимо коробов, которое ещё ждёт размещения (габарит, брак)."""
    lines = connection.execute(
        "SELECT id FROM shipment_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
    ).fetchall()
    return sum(line_aside_qty(connection, str(l["id"])) for l in lines)


def _putaway_line(connection, doc_id: str, line_id: str):
    row = connection.execute(
        "SELECT * FROM shipment_lines WHERE id = ? AND doc_id = ? AND COALESCE(is_deleted, 0) = 0",
        (line_id, doc_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Строка не найдена")
    return row


def _putaway_item_result(connection, doc_id: str, line, *, qty: int) -> dict:
    """Ответ поштучных операций ТСД: что зафиксировано и сколько собрано мимо коробов."""
    return {
        "line_id": str(line["id"]),
        "product_name": line["product_name"],
        "product_sku": line["product_sku"],
        "color_name": line["color_name"],
        "size_name": line["size_name"],
        "qty": qty,
        "aside_total": _aside_total(connection, doc_id),
    }


def add_aside_item(connection, doc_id: str, *, barcode: str, qty: int, quality: str, user_id: str) -> dict:
    """Скан товара мимо короба: габарит не влез либо упаковщик решил не класть в короб.

    Запись упаковки такая же, как у скана в короб (объём, дата, заработок), только без
    оси контейнера: товар ждёт развозки россыпью и уедет в зону отгрузки отдельным
    сканом на ТСД у стеллажа.
    """
    _require_putaway_doc(connection, doc_id)
    n = int(qty or 0)
    if n <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество больше нуля")
    q = _normalize_quality(quality)

    variant = variant_by_barcode(connection, barcode)
    line = _line_for_variant(connection, doc_id, variant, prefer_boxable=True)
    is_defect = q == INV_Q_DEFECT
    record_packing(
        connection, doc_id, str(line["id"]),
        good_delta=0 if is_defect else n, defect_delta=n if is_defect else 0,
        packed_date=business_today().isoformat(), user_id=user_id,
    )
    kind_ru = "брак" if is_defect else "годный"
    label = line["product_sku"] or line["product_name"]
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_ITEM_PLACE,
         f"Собрано без короба ({kind_ru}): {n} шт. — {label}", _now(), user_id),
    )
    return _putaway_item_result(connection, doc_id, line, qty=n)


def undo_aside_item(
    connection, doc_id: str, line_id: str, qty: int, user_id: str, quality: str | None = None,
) -> dict:
    """Отмена ошибочного скана мимо короба: товар возвращается в пул на столе упаковки.

    Россыпь разнородна, поэтому качество сужает выбор записи: без него сторнируется
    последний скан позиции любого качества.
    """
    _require_putaway_doc(connection, doc_id)
    line = _putaway_line(connection, doc_id, line_id)
    q = _normalize_quality(quality) if quality else None
    kind_ru = "" if q is None else " (брак)" if q == INV_Q_DEFECT else " (годный)"
    undone = _reverse_pack_entries(
        connection, doc_id, line_id, qty, user_id,
        leg_sql=(
            f"zr.to_op = '{INV_OP_PACKED}' AND zr.to_container_id IS NULL"
            + ("" if q is None else " AND zr.to_quality = ?")
        ),
        leg_params=() if q is None else (q,),
        empty_detail=f"По этой позиции нет сборки без короба{kind_ru}",
    )
    removed = sum(r["qty"] for r in undone)
    label = line["product_sku"] or line["product_name"]
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_ITEM_PLACE,
         f"Отмена сборки без короба{kind_ru}: -{removed} шт. — {label}", _now(), user_id),
    )
    return _putaway_item_result(connection, doc_id, line, qty=removed)


def log_placement_op(connection, doc_id: str, *, comment: str, user_id: str) -> None:
    """Запись о размещении в журнал задачи: развозку ведёт процесс коробов, а не задача.

    Задача к этому моменту уже закрыта — журнал append-only, поэтому след «куда уехало»
    дописывается и в закрытый документ: иначе историю короба пришлось бы искать в
    другом месте. Вызывается из `containers`, поэтому знание о `shipment_ops` живёт здесь.
    """
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_BOX_PLACE, comment, _now(), user_id),
    )


def finish_collecting(connection, doc_id: str, user_id: str) -> str:
    """Сборка завершена: on_packing -> packed. Это конец задачи.

    Гейт: открытых коробов с товаром не осталось. Упакованное уже в пуле отгрузки;
    закрытые короба и собранная россыпь задачу не держат — в зону отгрузки их везёт
    отдельный процесс развозки, у которого свой темп и своя очередь. Нерешённый пул
    со стола возвращается на хранение в те же места.
    """
    from modules.balances.service import get_packing_zone, insert_inventory_move
    from modules.containers.service import containers_items_qty

    doc = _require_putaway_doc(connection, doc_id)

    # Ошибочно взятая этикетка не должна держать задачу: пустые короба освобождаем сами.
    open_boxes = connection.execute(
        "SELECT * FROM containers WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0 AND status = ? "
        "ORDER BY doc_number",
        (doc_id, CONTAINER_STATUS_OPEN),
    ).fetchall()
    unclosed: list[str] = []
    for box in open_boxes:
        if containers_items_qty(connection, [str(box["id"])]).get(str(box["id"]), 0) <= 0:
            _release_empty_box(connection, doc_id, box, user_id)
        else:
            unclosed.append(str(box["doc_number"]))
    if unclosed:
        raise HTTPException(
            status_code=400,
            detail=f"Сначала закройте короба: {', '.join(unclosed)}",
        )

    packing_id, packing_name = get_packing_zone(connection)
    client_id = doc["client_id"]
    lines = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND COALESCE(is_deleted, 0) = 0", (doc_id,)
    ).fetchall()
    for line in lines:
        line_id = str(line["id"])
        leftover = line_on_packing_qty(connection, line_id)
        if leftover <= 0:
            continue
        pool_sources = line_bucket_zone_sources(
            connection, line_id, op=INV_OP_PACKING, quality=INV_Q_GOOD, prefer_zone_id=packing_id,
        )
        for pool_zone_id, pool_zone_name, part in _consume_zone_sources(
            pool_sources, leftover, fallback=(packing_id, packing_name)
        ):
            insert_inventory_move(
                connection,
                product_id=str(line["product_id"]), product_name=line["product_name"],
                product_sku=line["product_sku"],
                color_id=line["color_id"], color_name=line["color_name"],
                size_id=line["size_id"], size_name=line["size_name"],
                client_id=client_id, client_name=None,
                from_op=INV_OP_PACKING, to_op=INV_OP_STORAGE,
                from_quality=INV_Q_GOOD, to_quality=INV_Q_GOOD,
                from_zone_id=pool_zone_id, from_zone_name=pool_zone_name,
                to_zone_id=pool_zone_id, to_zone_name=pool_zone_name,
                qty=part, user_id=user_id, shipment_line_id=line_id,
                comment=f"Возврат нерешённого пула на хранение: {part} шт.",
            )

    collected_total = sum(line_boxed_qty(connection, str(l["id"])) for l in lines)
    now = _now()
    connection.execute(
        "UPDATE shipment_docs SET status = ?, actual_ship_date = COALESCE(actual_ship_date, ?), "
        "updated_at = ? WHERE id = ?",
        (SHIPMENT_STATUS_PACKED, business_today().isoformat(), now, doc_id),
    )
    connection.execute(
        "INSERT INTO shipment_ops (id,doc_id,op_type,comment,created_at,created_by) VALUES (?,?,?,?,?,?)",
        (str(uuid4()), doc_id, SHIPMENT_OP_COLLECTED,
         f"Упаковка завершена: {collected_total} шт. упаковано, короба и товар без короба ждут развозки", now, user_id),
    )
    return SHIPMENT_STATUS_PACKED
