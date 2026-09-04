from __future__ import annotations

from typing import Any, Mapping
from uuid import uuid4

from fastapi import HTTPException

from config import (
    CONTAINER_BATCH_MAX,
    CONTAINER_OP_CREATE,
    CONTAINER_OP_DELETE,
    CONTAINER_OP_ITEM_ADD,
    CONTAINER_OP_ITEM_REMOVE,
    CONTAINER_OP_MOVE,
    CONTAINER_OP_PLACE,
    CONTAINER_QR_PREFIX,
    CONTAINER_STATUS_CLOSED,
    CONTAINER_STATUS_NEW,
    CONTAINER_STATUS_OPEN,
    CONTAINER_STATUS_PLACED,
    INV_OP_PACKED,
    INV_OP_READY,
    INV_OP_STORAGE,
    INV_Q_DEFECT,
    INV_Q_GOOD,
    SHIPMENT_TASK_PUTAWAY,
)
from dbconn import barcode_variant_exists_sql, ci_like_substring_param, like_substring_param
from utils import next_doc_number as _next_doc_number, now_iso as _now, qr_svg

from .schemas import (
    ContainerContentLine,
    ContainerDeleteResult,
    ContainerHoldingRow,
    ContainerHoldingsResponse,
    ContainerItem,
    ContainerLabel,
    ContainerLabelsResponse,
    ContainerListResponse,
    ContainerLookupResponse,
    ContainerOpItem,
    ContainerPendingAsideItem,
    ContainerPendingBox,
    ContainerPendingPlacement,
    ContainerPlacedItem,
    ContainerPlaceItemScan,
    ContainerPlaceResult,
)

# Тот же потолок печати, что у этикеток мест хранения.
LABELS_LIMIT = 500


def next_container_number(connection) -> str:
    """Следующий номер короба (BOX-000123)."""
    return _next_doc_number(connection, table="containers", prefix="BOX-", width=6)


def _row_to_item(row: Mapping[str, Any], items_qty: int = 0) -> ContainerItem:
    return ContainerItem(
        id=str(row["id"]),
        doc_number=str(row["doc_number"]),
        status=str(row["status"]),
        doc_id=row["doc_id"],
        doc_number_task=row["doc_number_task"],
        client_id=row["client_id"],
        client_name=row["client_name"],
        store_id=row["store_id"],
        store_name=row["store_name"],
        zone_id=row["zone_id"],
        zone_name=row["zone_name"],
        items_qty=items_qty,
        created_at=str(row["created_at"]),
        closed_at=row["closed_at"],
        placed_at=row["placed_at"],
    )


_SELECT_COLS = (
    "c.id, c.doc_number, c.status, c.doc_id, c.client_id, c.client_name, c.store_id, c.store_name, "
    "c.zone_id, c.zone_name, c.created_at, c.closed_at, c.placed_at, d.doc_number AS doc_number_task"
)
_FROM_SQL = "FROM containers c LEFT JOIN shipment_docs d ON d.id = c.doc_id"


def create_containers(connection, count: int, user_id: str) -> list[ContainerItem]:
    """Заводит `count` пустых коробов под печать этикеток. Без commit."""
    n = int(count or 0)
    if n <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество коробов")
    if n > CONTAINER_BATCH_MAX:
        raise HTTPException(status_code=400, detail=f"За один раз можно завести не больше {CONTAINER_BATCH_MAX} коробов")

    now = _now()
    created: list[ContainerItem] = []
    # Номера идут подряд от текущего максимума: next_doc_number на каждой итерации —
    # лишний round-trip, а гонку всё равно ловит UNIQUE-индекс.
    start_number = next_container_number(connection)
    start_n = int(start_number[len("BOX-"):])
    for i in range(n):
        cid = str(uuid4())
        number = f"BOX-{start_n + i:06d}"
        connection.execute(
            "INSERT INTO containers (id, doc_number, status, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
            (cid, number, CONTAINER_STATUS_NEW, now, user_id),
        )
        log_container_op(
            connection, container_id=cid, op_type=CONTAINER_OP_CREATE,
            comment="Короб заведён, этикетка напечатана", user_id=user_id,
        )
        created.append(
            ContainerItem(id=cid, doc_number=number, status=CONTAINER_STATUS_NEW, created_at=now)
        )
    return created


def delete_unused_containers(connection, ids: list[str], user_id: str) -> ContainerDeleteResult:
    """Удаляет свободные короба ошибочной пачки. Без commit.

    Удалять можно только тару, которую ещё не пустили в дело: статус «свободен» и
    ни одной записи в журнале перемещений по оси короба. Короб в работе не удаляется
    молча — его номер возвращается в `skipped_numbers`, чтобы человек увидел, что не вышло.
    """
    wanted = [str(i).strip() for i in (ids or []) if str(i).strip()]
    if not wanted:
        raise HTTPException(status_code=400, detail="Выберите короба для удаления")

    rows = connection.execute(
        "SELECT id, doc_number, status FROM containers "
        "WHERE id = ANY(?) AND COALESCE(is_deleted, 0) = 0",
        (wanted,),
    ).fetchall()
    used_rows = connection.execute(
        "SELECT DISTINCT from_container_id AS cid FROM zone_relocations WHERE from_container_id = ANY(?) "
        "UNION SELECT DISTINCT to_container_id FROM zone_relocations WHERE to_container_id = ANY(?)",
        (wanted, wanted),
    ).fetchall()
    used = {str(r["cid"]) for r in used_rows if r["cid"]}

    now = _now()
    deleted = 0
    skipped_numbers: list[str] = []
    for row in rows:
        cid = str(row["id"])
        if str(row["status"]) != CONTAINER_STATUS_NEW or cid in used:
            skipped_numbers.append(str(row["doc_number"]))
            continue
        connection.execute(
            "UPDATE containers SET is_deleted = 1, updated_at = ? WHERE id = ?",
            (now, cid),
        )
        log_container_op(
            connection, container_id=cid, op_type=CONTAINER_OP_DELETE,
            comment="Короб удалён из реестра: этикетка не пущена в дело", user_id=user_id,
        )
        deleted += 1

    missing = len(wanted) - len(rows)
    return ContainerDeleteResult(
        deleted=deleted,
        skipped=len(skipped_numbers) + max(missing, 0),
        skipped_numbers=skipped_numbers,
    )


def log_container_op(
    connection, *, container_id: str, op_type: str, user_id: str | None,
    doc_id: str | None = None, product_id: str | None = None, product_name: str | None = None,
    product_sku: str | None = None, color_name: str | None = None, size_name: str | None = None,
    qty: int | None = None, zone_id: str | None = None, zone_name: str | None = None,
    comment: str | None = None,
) -> None:
    """Запись в журнал короба (append-only, читаемая история карточки). Без commit."""
    connection.execute(
        "INSERT INTO container_ops "
        "(id, container_id, op_type, doc_id, product_id, product_name, product_sku, color_name, size_name, "
        " qty, zone_id, zone_name, comment, created_at, created_by) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (str(uuid4()), container_id, op_type, doc_id, product_id, product_name, product_sku,
         color_name, size_name, qty, zone_id, zone_name, comment, _now(), user_id),
    )


def container_stock_rows(connection, container_id: str) -> list[dict]:
    """Что физически лежит в коробе — нетто журнала по оси контейнера.

    Одна строка на (строка задачи, позиция, корзина, место) с net > 0. Перенос
    короба ставит обе стороны оси (from=to), поэтому содержимое при переезде не
    меняется — меняется только место в строках.
    """
    rows = connection.execute(
        """
        WITH moves AS (
            SELECT shipment_line_id, product_id, color_id, size_id, client_id,
                   product_name, product_sku, color_name, size_name, client_name,
                   to_op AS op, to_quality AS quality, to_zone_id AS zone_id, to_zone_name AS zone_name,
                   qty AS net
            FROM zone_relocations WHERE to_container_id = ?
            UNION ALL
            SELECT shipment_line_id, product_id, color_id, size_id, client_id,
                   product_name, product_sku, color_name, size_name, client_name,
                   from_op, from_quality, from_zone_id, from_zone_name,
                   -qty
            FROM zone_relocations WHERE from_container_id = ?
        )
        SELECT shipment_line_id, product_id, color_id, size_id, client_id, op, quality, zone_id,
               MIN(product_name) AS product_name, MIN(product_sku) AS product_sku,
               MIN(color_name) AS color_name, MIN(size_name) AS size_name,
               MIN(client_name) AS client_name, MIN(zone_name) AS zone_name,
               SUM(net) AS net
        FROM moves
        GROUP BY shipment_line_id, product_id, color_id, size_id, client_id, op, quality, zone_id
        HAVING SUM(net) > 0
        ORDER BY MIN(product_name)
        """,
        (container_id, container_id),
    ).fetchall()
    return [
        {
            "shipment_line_id": r["shipment_line_id"],
            "product_id": str(r["product_id"]),
            "product_name": r["product_name"],
            "product_sku": r["product_sku"],
            "color_id": r["color_id"],
            "color_name": r["color_name"],
            "size_id": r["size_id"],
            "size_name": r["size_name"],
            "client_id": r["client_id"],
            "client_name": r["client_name"],
            "op": str(r["op"]),
            "quality": str(r["quality"]),
            "zone_id": r["zone_id"],
            "zone_name": r["zone_name"],
            "net": int(r["net"] or 0),
        }
        for r in rows
    ]


def container_contents(connection, container_id: str) -> list[ContainerContentLine]:
    """Содержимое короба, свёрнутое по позициям и качеству (для карточки и ТСД).

    Качество в ключе: короб набирается либо годным, либо браком, и на ТСД по нему
    различаются подписи операций. Смешанный короб возможен только в данных, собранных
    до этого правила, — тогда позиция покажется двумя строками.
    """
    agg: dict[tuple, ContainerContentLine] = {}
    for r in container_stock_rows(connection, container_id):
        key = (r["shipment_line_id"], r["product_id"], r["color_id"], r["size_id"], r["quality"])
        line = agg.get(key)
        if line is None:
            agg[key] = ContainerContentLine(
                line_id=r["shipment_line_id"],
                product_id=r["product_id"], product_name=r["product_name"], product_sku=r["product_sku"],
                color_id=r["color_id"], color_name=r["color_name"],
                size_id=r["size_id"], size_name=r["size_name"],
                quality=r["quality"], qty=r["net"],
            )
        else:
            line.qty += r["net"]
    return list(agg.values())


def container_quality(connection, container_id: str) -> str | None:
    """Чем набран короб: `good`, `defect`, `mixed` (легаси) или None у пустого."""
    qualities = {r["quality"] for r in container_stock_rows(connection, container_id) if r["net"] > 0}
    if not qualities:
        return None
    if len(qualities) > 1:
        return "mixed"
    return next(iter(qualities))


def containers_items_qty(connection, container_ids: list[str]) -> dict[str, int]:
    """Сколько штук лежит в каждом коробе (нетто по оси контейнера)."""
    ids = [str(i) for i in container_ids if i]
    if not ids:
        return {}
    rows = connection.execute(
        """
        SELECT container_id, SUM(net) AS net FROM (
            SELECT to_container_id AS container_id, qty AS net
            FROM zone_relocations WHERE to_container_id = ANY(?)
            UNION ALL
            SELECT from_container_id, -qty
            FROM zone_relocations WHERE from_container_id = ANY(?)
        ) t
        GROUP BY container_id
        """,
        (ids, ids),
    ).fetchall()
    return {str(r["container_id"]): int(r["net"] or 0) for r in rows}


# Короба, в которых сейчас лежит подходящий товар: нетто оси короба по варианту.
# Без HAVING > 0 в выдачу попадут короба, из которых товар давно изъяли.
_CONTENT_MATCH_SQL = """
    c.id IN (
        SELECT z.cid FROM (
            SELECT to_container_id AS cid, product_id, color_id, size_id, qty AS net
            FROM zone_relocations WHERE to_container_id IS NOT NULL
            UNION ALL
            SELECT from_container_id, product_id, color_id, size_id, -qty
            FROM zone_relocations WHERE from_container_id IS NOT NULL
        ) z
        LEFT JOIN products prod ON prod.id = z.product_id
        WHERE {match}
        GROUP BY z.cid, z.product_id, z.color_id, z.size_id
        HAVING SUM(z.net) > 0
    )"""


def list_containers(
    connection, *, page: int, limit: int,
    status: str | None = None, client_id: str | None = None,
    doc_id: str | None = None, zone_id: str | None = None, search: str | None = None,
    product_id: str | None = None,
) -> ContainerListResponse:
    conds = ["COALESCE(c.is_deleted, 0) = 0"]
    params: list[Any] = []
    if status and status.strip():
        conds.append("c.status = ?"); params.append(status.strip())
    if client_id and client_id.strip():
        conds.append("c.client_id = ?"); params.append(client_id.strip())
    if doc_id and doc_id.strip():
        conds.append("c.doc_id = ?"); params.append(doc_id.strip())
    if zone_id and zone_id.strip():
        conds.append("c.zone_id = ?"); params.append(zone_id.strip())
    if product_id and product_id.strip():
        conds.append(_CONTENT_MATCH_SQL.format(match="z.product_id = ?"))
        params.append(product_id.strip())
    if search and search.strip():
        s = ci_like_substring_param(search)
        # Тот же поиск, что в остатках, плюс состав короба: «в каком коробе лежит SKU»
        # спрашивают и со стороны списка коробов.
        content = _CONTENT_MATCH_SQL.format(match=(
            "fold_ci(prod.name) LIKE ? OR fold_ci(prod.sku) LIKE ? OR "
            + barcode_variant_exists_sql("z.product_id", "z.color_id", "z.size_id")
        ))
        conds.append(
            "(fold_ci(c.doc_number) LIKE ? OR fold_ci(c.zone_name) LIKE ? OR fold_ci(c.client_name) LIKE ?"
            f" OR {content})"
        )
        params += [s, s, s, s, s, like_substring_param(search)]
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n {_FROM_SQL} WHERE {where}", params
    ).fetchone()["n"])
    offset = (page - 1) * limit
    rows = connection.execute(
        f"SELECT {_SELECT_COLS} {_FROM_SQL} WHERE {where} "
        # Свободные этикетки уходят вниз: пачка из 200 новых коробов иначе накрывает
        # первую страницу и прячет то, с чем реально работают.
        "ORDER BY (c.status = ?) ASC, c.created_at DESC, c.doc_number DESC LIMIT ? OFFSET ?",
        [*params, CONTAINER_STATUS_NEW, limit, offset],
    ).fetchall()
    qty_by_id = containers_items_qty(connection, [str(r["id"]) for r in rows])
    return ContainerListResponse(
        items=[_row_to_item(r, qty_by_id.get(str(r["id"]), 0)) for r in rows],
        total=total, page=page, limit=limit,
    )


def get_container_row(connection, container_id: str):
    return connection.execute(
        f"SELECT {_SELECT_COLS} {_FROM_SQL} WHERE c.id = ? AND COALESCE(c.is_deleted, 0) = 0",
        (container_id,),
    ).fetchone()


def require_container(connection, container_id: str):
    row = get_container_row(connection, container_id)
    if not row:
        raise HTTPException(status_code=404, detail="Короб не найден")
    return row


def container_item(connection, container_id: str) -> ContainerItem:
    row = require_container(connection, container_id)
    qty = containers_items_qty(connection, [container_id]).get(container_id, 0)
    return _row_to_item(row, qty)


def list_container_ops(connection, container_id: str) -> list[ContainerOpItem]:
    rows = connection.execute(
        "SELECT o.*, COALESCE(NULLIF(u.display_name, ''), u.email) AS created_by_name "
        "FROM container_ops o LEFT JOIN users u ON u.id = o.created_by "
        "WHERE o.container_id = ? ORDER BY o.created_at DESC",
        (container_id,),
    ).fetchall()
    return [
        ContainerOpItem(
            id=str(r["id"]), op_type=str(r["op_type"]),
            product_name=r["product_name"], product_sku=r["product_sku"],
            color_name=r["color_name"], size_name=r["size_name"],
            qty=int(r["qty"]) if r["qty"] is not None else None,
            zone_name=r["zone_name"], comment=r["comment"],
            created_at=str(r["created_at"]), created_by=r["created_by"],
            created_by_name=r["created_by_name"],
        )
        for r in rows
    ]


def lookup_container(connection, raw: str) -> ContainerLookupResponse:
    """Скан: payload QR («wms:box:<id>»), голый id или номер BOX-000123 → короб."""
    s = (raw or "").strip()
    if s.startswith(CONTAINER_QR_PREFIX):
        s = s[len(CONTAINER_QR_PREFIX):].strip()
    if not s:
        return ContainerLookupResponse(found=False)
    row = connection.execute(
        f"SELECT {_SELECT_COLS} {_FROM_SQL} WHERE c.id = ? AND COALESCE(c.is_deleted, 0) = 0", (s,)
    ).fetchone()
    if not row:
        row = connection.execute(
            f"SELECT {_SELECT_COLS} {_FROM_SQL} "
            "WHERE fold_ci(c.doc_number) = fold_ci(?) AND COALESCE(c.is_deleted, 0) = 0",
            (s,),
        ).fetchone()
    if not row:
        return ContainerLookupResponse(found=False)
    qty = containers_items_qty(connection, [str(row["id"])]).get(str(row["id"]), 0)
    return ContainerLookupResponse(found=True, container=_row_to_item(row, qty))


def container_labels(connection, ids: list[str] | None) -> ContainerLabelsResponse:
    selected = [str(i).strip() for i in (ids or []) if str(i).strip()]
    if not selected:
        raise HTTPException(status_code=400, detail="Выберите короба для печати этикеток")
    rows = connection.execute(
        "SELECT id, doc_number FROM containers "
        "WHERE id = ANY(?) AND COALESCE(is_deleted, 0) = 0 ORDER BY doc_number LIMIT ?",
        (selected, LABELS_LIMIT),
    ).fetchall()
    items = []
    for r in rows:
        payload = f"{CONTAINER_QR_PREFIX}{r['id']}"
        items.append(ContainerLabel(
            id=str(r["id"]), doc_number=str(r["doc_number"]), payload=payload, qr_svg=qr_svg(payload),
        ))
    return ContainerLabelsResponse(items=items)


def _zone_row(connection, zone_id: str, empty_detail: str):
    zid = (zone_id or "").strip()
    if not zid:
        raise HTTPException(status_code=400, detail=empty_detail)
    row = connection.execute(
        "SELECT id, name, kind, is_active FROM unloading_zones "
        "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (zid,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Место не найдено")
    return row


def require_location(connection, zone_id: str, *, empty_detail: str) -> tuple[str, str]:
    """Валидация места хранения: любое активное место справочника. → (id, name).

    Адресной ячейки стеллажа не требуем ни от короба, ни от россыпи: зона брака или
    негабарита на складе может быть заведена служебным местом.
    """
    row = _zone_row(connection, zone_id, empty_detail)
    if not int(row["is_active"] or 0):
        raise HTTPException(status_code=400, detail=f"Место «{row['name']}» отключено — выберите другое")
    return str(row["id"]), str(row["name"])


def move_placed_container(connection, container_id: str, zone_id: str, user_id: str) -> ContainerItem:
    """Перенос размещённого короба в другую ячейку: скан короба → скан новой ячейки.

    Товар остаётся в том же коробе (обе стороны оси контейнера — этот короб),
    меняется только место: (storage, quality)@старая → (storage, quality)@новая.
    """
    from modules.balances.service import insert_inventory_move

    row = require_container(connection, container_id)
    if str(row["status"]) != CONTAINER_STATUS_PLACED:
        raise HTTPException(status_code=400, detail="Перемещать можно только размещённый короб")
    to_zone_id, to_zone_name = require_location(
        connection, zone_id, empty_detail="Отсканируйте место хранения",
    )
    if str(row["zone_id"] or "") == to_zone_id:
        raise HTTPException(status_code=400, detail="Короб уже стоит в этой ячейке")

    stock = container_stock_rows(connection, container_id)
    moved = 0
    for r in stock:
        insert_inventory_move(
            connection,
            product_id=r["product_id"], product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=r["client_id"], client_name=r["client_name"],
            from_op=r["op"], to_op=r["op"],
            from_quality=r["quality"], to_quality=r["quality"],
            from_zone_id=r["zone_id"], from_zone_name=r["zone_name"],
            to_zone_id=to_zone_id, to_zone_name=to_zone_name,
            qty=r["net"], user_id=user_id,
            from_container_id=container_id, to_container_id=container_id,
            shipment_line_id=r["shipment_line_id"],
            comment=f"Перенос короба {row['doc_number']}: {r['zone_name'] or 'без места'} → {to_zone_name}",
        )
        moved += r["net"]

    connection.execute(
        "UPDATE containers SET zone_id = ?, zone_name = ?, updated_at = ? WHERE id = ?",
        (to_zone_id, to_zone_name, _now(), container_id),
    )
    log_container_op(
        connection, container_id=container_id, op_type=CONTAINER_OP_MOVE, user_id=user_id,
        qty=moved, zone_id=to_zone_id, zone_name=to_zone_name,
        comment=f"Перенесён в ячейку {to_zone_name}",
    )
    return container_item(connection, container_id)


def containers_holding(
    connection, *, product_id: str, color_id: str | None, size_id: str | None,
    client_id: str | None, zone_id: str | None, op: str = INV_OP_STORAGE, quality: str,
) -> list[tuple[str, int]]:
    """Короба, в которых сейчас лежит позиция в этом месте: [(номер, штук)], нетто > 0.

    Гейт ручных операций с остатками: товар, лежащий в коробе, нельзя двигать или
    списывать «мимо короба» — иначе содержимое короба разойдётся с остатками. Часть
    той же позиции может лежать в месте россыпью (изъятая из короба), поэтому нужно
    количество, а не только факт.
    """
    rows = connection.execute(
        """
        SELECT c.doc_number, SUM(t.net) AS net FROM (
            SELECT to_container_id AS container_id, qty AS net
            FROM zone_relocations
            WHERE to_container_id IS NOT NULL
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ? AND size_id IS NOT DISTINCT FROM ?
              AND client_id IS NOT DISTINCT FROM ?
              AND to_op = ? AND to_quality = ? AND to_zone_id IS NOT DISTINCT FROM ?
            UNION ALL
            SELECT from_container_id, -qty
            FROM zone_relocations
            WHERE from_container_id IS NOT NULL
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ? AND size_id IS NOT DISTINCT FROM ?
              AND client_id IS NOT DISTINCT FROM ?
              AND from_op = ? AND from_quality = ? AND from_zone_id IS NOT DISTINCT FROM ?
        ) t
        JOIN containers c ON c.id = t.container_id
        GROUP BY c.doc_number
        HAVING SUM(t.net) > 0
        ORDER BY c.doc_number
        """,
        (product_id, color_id, size_id, client_id, op, quality, zone_id,
         product_id, color_id, size_id, client_id, op, quality, zone_id),
    ).fetchall()
    return [(str(r["doc_number"]), int(r["net"] or 0)) for r in rows]


# ── Развозка: упакованное едет со стола в зону отгрузки ─────────────────────────

def _place_closed_box(connection, box, zone: tuple[str, str], user_id: str) -> int:
    """Короб уехал со стола: packed → ready в отсканированное место. → сколько штук.

    Та же раскладка, что «Готово к рейсу» у задачи упаковки, только коробом целиком и
    вне документа: к отгрузке товар доступен уже с упаковки, развозка лишь даёт ему место.
    """
    from modules.balances.service import insert_inventory_move
    from modules.shipments.service import log_placement_op

    container_id = str(box["id"])
    stock = [r for r in container_stock_rows(connection, container_id) if r["op"] == INV_OP_PACKED]
    if not stock:
        raise HTTPException(status_code=400, detail=f"Короб {box['doc_number']} пустой — размещать нечего")

    to_zone_id, to_zone_name = zone
    moved = 0
    for r in stock:
        insert_inventory_move(
            connection,
            product_id=r["product_id"], product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=r["client_id"], client_name=r["client_name"],
            from_op=INV_OP_PACKED, to_op=INV_OP_READY,
            from_quality=r["quality"], to_quality=r["quality"],
            from_zone_id=r["zone_id"], from_zone_name=r["zone_name"],
            to_zone_id=to_zone_id, to_zone_name=to_zone_name,
            qty=r["net"], user_id=user_id,
            from_container_id=container_id, to_container_id=container_id,
            shipment_line_id=r["shipment_line_id"],
            comment=f"Размещение короба {box['doc_number']}: {r['net']} шт → {to_zone_name}",
        )
        moved += r["net"]

    now = _now()
    connection.execute(
        "UPDATE containers SET status = ?, zone_id = ?, zone_name = ?, placed_at = ?, updated_at = ? WHERE id = ?",
        (CONTAINER_STATUS_PLACED, to_zone_id, to_zone_name, now, now, container_id),
    )
    log_container_op(
        connection, container_id=container_id, op_type=CONTAINER_OP_PLACE, user_id=user_id,
        doc_id=box["doc_id"], qty=moved, zone_id=to_zone_id, zone_name=to_zone_name,
        comment=f"Размещён в месте {to_zone_name}",
    )
    if box["doc_id"]:
        log_placement_op(
            connection, str(box["doc_id"]), user_id=user_id,
            comment=f"Короб {box['doc_number']} размещён: {moved} шт. → {to_zone_name}",
        )
    return moved


# Упакованное без короба у стола принадлежит только задачам с ТСД: «Упаковано» обычной
# задачи упаковки раскладывает «Готово к рейсу» внутри документа, развозке оно не видно.
_PUTAWAY_LINE_SQL = f"""shipment_line_id IN (
        SELECT l.id FROM shipment_lines l JOIN shipment_docs d ON d.id = l.doc_id
        WHERE d.task_kind = '{SHIPMENT_TASK_PUTAWAY}')"""


def _aside_sources(connection, variant: dict, quality: str | None) -> list[dict]:
    """Собранное без короба по варианту: строки задачи с ТСД, где нетто packed > 0.

    Россыпь опознаётся пустой осью короба. Место назначения ей выбирает кладовщик у
    стеллажа, поэтому источники берутся по всем живым задачам сразу.
    """
    rows = connection.execute(
        f"""
        WITH moves AS (
            SELECT shipment_line_id, product_id, color_id, size_id, client_id,
                   product_name, product_sku, color_name, size_name, client_name,
                   to_quality AS quality, to_zone_id AS zone_id, to_zone_name AS zone_name, qty AS net
            FROM zone_relocations
            WHERE to_op = '{INV_OP_PACKED}' AND to_container_id IS NULL AND {_PUTAWAY_LINE_SQL}
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ?::text AND size_id IS NOT DISTINCT FROM ?::text
            UNION ALL
            SELECT shipment_line_id, product_id, color_id, size_id, client_id,
                   product_name, product_sku, color_name, size_name, client_name,
                   from_quality, from_zone_id, from_zone_name, -qty
            FROM zone_relocations
            WHERE from_op = '{INV_OP_PACKED}' AND from_container_id IS NULL AND {_PUTAWAY_LINE_SQL}
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ?::text AND size_id IS NOT DISTINCT FROM ?::text
        )
        SELECT shipment_line_id, product_id, color_id, size_id, client_id, quality, zone_id,
               MIN(product_name) AS product_name, MIN(product_sku) AS product_sku,
               MIN(color_name) AS color_name, MIN(size_name) AS size_name,
               MIN(client_name) AS client_name, MIN(zone_name) AS zone_name,
               SUM(net) AS net
        FROM moves
        GROUP BY shipment_line_id, product_id, color_id, size_id, client_id, quality, zone_id
        HAVING SUM(net) > 0
        ORDER BY MIN(product_name)
        """,
        (variant["product_id"], variant["color_id"], variant["size_id"],
         variant["product_id"], variant["color_id"], variant["size_id"]),
    ).fetchall()
    sources = [
        {
            "shipment_line_id": r["shipment_line_id"],
            "product_id": str(r["product_id"]), "product_name": r["product_name"],
            "product_sku": r["product_sku"],
            "color_id": r["color_id"], "color_name": r["color_name"],
            "size_id": r["size_id"], "size_name": r["size_name"],
            "client_id": r["client_id"], "client_name": r["client_name"],
            "quality": str(r["quality"]), "zone_id": r["zone_id"], "zone_name": r["zone_name"],
            "net": int(r["net"] or 0),
        }
        for r in rows
    ]
    if quality:
        return [r for r in sources if r["quality"] == quality]
    qualities = {r["quality"] for r in sources}
    if len(qualities) > 1:
        raise HTTPException(
            status_code=400,
            detail="По этому товару развозки ждут и годный, и брак — укажите качество",
        )
    return sources


# Что лежит на полке россыпью и переезжает сканом: хранение и развезённое в зону
# отгрузки. Процессные корзины стола (packing/packed) ТСД не трогает.
_SHELF_OPS_SQL = ", ".join(f"'{s}'" for s in (INV_OP_STORAGE, INV_OP_READY))


def free_storage_sources(connection, variant: dict, quality: str | None, zone_id: str | None) -> list[dict]:
    """Свободный (вне коробов) остаток позиции на полке: по местам, корзине и качеству.

    Товар в коробе двигается только коробом целиком, поэтому в источники переноса
    попадает лишь то, у чего ось короба пуста.
    """
    conds = " AND to_zone_id = ?" if zone_id else ""
    params: list[Any] = [variant["product_id"], variant["color_id"], variant["size_id"]]
    if zone_id:
        params.append(zone_id)
    rows = connection.execute(
        f"""
        WITH moves AS (
            SELECT product_id, color_id, size_id, client_id,
                   product_name, product_sku, color_name, size_name, client_name,
                   to_op AS op, to_quality AS quality, to_zone_id AS zone_id, to_zone_name AS zone_name, qty AS net
            FROM zone_relocations
            WHERE to_op IN ({_SHELF_OPS_SQL}) AND to_container_id IS NULL
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ?::text AND size_id IS NOT DISTINCT FROM ?::text
              {conds}
            UNION ALL
            SELECT product_id, color_id, size_id, client_id,
                   product_name, product_sku, color_name, size_name, client_name,
                   from_op, from_quality, from_zone_id, from_zone_name, -qty
            FROM zone_relocations
            WHERE from_op IN ({_SHELF_OPS_SQL}) AND from_container_id IS NULL
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ?::text AND size_id IS NOT DISTINCT FROM ?::text
              {conds.replace('to_zone_id', 'from_zone_id')}
        )
        SELECT product_id, color_id, size_id, client_id, op, quality, zone_id,
               MIN(product_name) AS product_name, MIN(product_sku) AS product_sku,
               MIN(color_name) AS color_name, MIN(size_name) AS size_name,
               MIN(client_name) AS client_name, MIN(zone_name) AS zone_name,
               SUM(net) AS net
        FROM moves
        GROUP BY product_id, color_id, size_id, client_id, op, quality, zone_id
        HAVING SUM(net) > 0
        ORDER BY SUM(net) DESC
        """,
        (*params, *params),
    ).fetchall()
    sources = [
        {
            "product_id": str(r["product_id"]), "product_name": r["product_name"], "product_sku": r["product_sku"],
            "color_id": r["color_id"], "color_name": r["color_name"],
            "size_id": r["size_id"], "size_name": r["size_name"],
            "client_id": r["client_id"], "client_name": r["client_name"],
            "op": str(r["op"]), "quality": str(r["quality"]),
            "zone_id": r["zone_id"], "zone_name": r["zone_name"],
            "net": int(r["net"] or 0),
        }
        for r in rows
    ]
    if quality:
        return [r for r in sources if r["quality"] == quality]
    return sources


def _quality_word(quality: str | None) -> str:
    return {INV_Q_GOOD: "годным", INV_Q_DEFECT: "браком"}.get(quality or "", "смешанно")


def _ensure_box_accepts(connection, box, quality: str) -> None:
    """Короб однороден по качеству: годный и брак в одной таре запрещены."""
    box_q = container_quality(connection, str(box["id"]))
    if box_q and box_q != quality:
        raise HTTPException(
            status_code=400,
            detail=f"Короб {box['doc_number']} набран {_quality_word(box_q)} — {_quality_word(quality)} в него не кладут",
        )


def _log_box_add(connection, box, *, label: dict, qty: int, quality: str, source: str, user_id: str) -> None:
    log_container_op(
        connection, container_id=str(box["id"]), op_type=CONTAINER_OP_ITEM_ADD, user_id=user_id,
        doc_id=box["doc_id"], product_id=label.get("product_id"), product_name=label.get("product_name"),
        product_sku=label.get("product_sku"), color_name=label.get("color_name"), size_name=label.get("size_name"),
        qty=qty, zone_id=box["zone_id"], zone_name=box["zone_name"],
        comment=f"Доложено в размещённый короб ({_quality_word(quality)}): +{qty} шт. из {source}",
    )


def _move_from_storage(
    connection, *, sources: list[dict], qty: int, zone: tuple[str, str], user_id: str,
    to_container=None,
) -> dict:
    """Перенос товара с полки: место → место в той же корзине. → строка ответа.

    Считает и пишет движения общий код ручного перемещения (`balances`): там живут
    гейт короба, проверка остатка и дробление по атрибуции к строкам документов.
    to_container — товар докладывается в размещённый короб (ось короба на приёмнике).
    """
    from types import SimpleNamespace

    from modules.balances.service import _create_relocation_moves

    to_zone_id, to_zone_name = zone
    remaining = qty
    label = None
    for src in sources:
        if remaining <= 0:
            break
        if src["zone_id"] == to_zone_id and to_container is None:
            continue  # уже стоит там, куда несут
        take = min(remaining, src["net"])
        if to_container is not None:
            _ensure_box_accepts(connection, to_container, src["quality"])
        comment = (
            f"В короб {to_container['doc_number']}: {src['zone_name'] or 'без места'} → {to_zone_name}"
            if to_container is not None else
            f"Перенос: {src['zone_name'] or 'без места'} → {to_zone_name}"
        )
        _create_relocation_moves(
            connection,
            SimpleNamespace(
                product_id=src["product_id"], product_name=src["product_name"], product_sku=src["product_sku"],
                color_id=src["color_id"], color_name=src["color_name"],
                size_id=src["size_id"], size_name=src["size_name"],
                client_id=src["client_id"], client_name=src["client_name"],
                op=src["op"], quality=src["quality"],
                from_zone_id=src["zone_id"], to_zone_id=to_zone_id,
                qty=take, comment=comment,
            ),
            user_id,
            to_container_id=str(to_container["id"]) if to_container is not None else None,
        )
        if to_container is not None:
            _log_box_add(
                connection, to_container, label=src, qty=take, quality=src["quality"],
                source=f"места {src['zone_name'] or '—'}", user_id=user_id,
            )
        label = label or src
        remaining -= take
    if label is None:
        raise HTTPException(status_code=400, detail="Этот товар уже лежит в выбранном месте")

    return ContainerPlacedItem(
        product_name=label["product_name"], product_sku=label["product_sku"],
        color_name=label["color_name"], size_name=label["size_name"],
        quality=label["quality"], qty=qty - remaining, from_collected=False,
    ).model_dump()


def _place_aside_item(
    connection, *, variant: dict, qty: int, quality: str | None, from_zone_id: str | None,
    zone: tuple[str, str], user_id: str, collected_only: bool = False, to_container=None,
) -> tuple[dict, dict[str, int]]:
    """Скан товара: собранное едет в зону отгрузки, лежащее на полке — переносится.

    Что именно взято, решает не режим экрана, а сам товар: сначала смотрим, не ждёт
    ли он развозки у стола (упакованное без короба), иначе берём свободный остаток на хранении.
    collected_only — источник «Зона упаковки» назван явно: на полку не заглядываем.
    Второе значение — сколько штук ушло по каждой строке задачи с ТСД: перенос
    с полки не относится ни к какой задаче и отдаёт пустой словарь.
    """
    from modules.balances.service import insert_inventory_move

    n = int(qty or 0)
    if n <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество больше нуля")
    q = (quality or "").strip() or None
    if q and q not in (INV_Q_GOOD, INV_Q_DEFECT):
        raise HTTPException(status_code=400, detail="Укажите качество: годный или брак")

    sources = [] if from_zone_id else _aside_sources(connection, variant, q)
    if not sources:
        if collected_only:
            raise HTTPException(
                status_code=400,
                detail="Этот товар не ждёт развозки у стола — проверьте, что сканируете",
            )
        storage = free_storage_sources(connection, variant, q, from_zone_id)
        if not storage:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Этот товар нигде не числится свободным — проверьте, что сканируете"
                    if not from_zone_id else
                    "В этом месте такого товара нет (или он лежит в коробе — тогда укажите короб как источник)"
                ),
            )
        qualities = {r["quality"] for r in storage}
        if len(qualities) > 1:
            raise HTTPException(
                status_code=400, detail="В этом товаре есть и годный, и брак — укажите качество",
            )
        zones = {r["zone_id"] for r in storage}
        if not from_zone_id and len(zones) > 1:
            raise HTTPException(
                status_code=400, detail="Товар лежит в нескольких местах — укажите, откуда берёте",
            )
        available = sum(r["net"] for r in storage)
        if available < n:
            raise HTTPException(
                status_code=400, detail=f"Доступно только {available} шт. этого товара",
            )
        return _move_from_storage(
            connection, sources=storage, qty=n, zone=zone, user_id=user_id, to_container=to_container,
        ), {}

    available = sum(r["net"] for r in sources)
    if available < n:
        raise HTTPException(
            status_code=400,
            detail=f"Развозки ждёт только {available} шт. этого товара — проверьте, что сканируете",
        )

    to_zone_id, to_zone_name = zone
    placed_quality = q or (sources[0]["quality"] if sources else INV_Q_GOOD)
    if to_container is not None:
        _ensure_box_accepts(connection, to_container, placed_quality)
    lines: dict[str, int] = {}
    remaining = n
    label = None
    for src in sources:
        if remaining <= 0:
            break
        take = min(remaining, src["net"])
        insert_inventory_move(
            connection,
            product_id=src["product_id"], product_name=src["product_name"], product_sku=src["product_sku"],
            color_id=src["color_id"], color_name=src["color_name"],
            size_id=src["size_id"], size_name=src["size_name"],
            client_id=src["client_id"], client_name=src["client_name"],
            from_op=INV_OP_PACKED, to_op=INV_OP_READY,
            from_quality=src["quality"], to_quality=src["quality"],
            from_zone_id=src["zone_id"], from_zone_name=src["zone_name"],
            to_zone_id=to_zone_id, to_zone_name=to_zone_name,
            qty=take, user_id=user_id, shipment_line_id=src["shipment_line_id"],
            to_container_id=str(to_container["id"]) if to_container is not None else None,
            comment=(
                f"Со стола в короб {to_container['doc_number']}: {take} шт → {to_zone_name}"
                if to_container is not None else
                f"Размещение без короба: {take} шт → {to_zone_name}"
            ),
        )
        if src["shipment_line_id"]:
            key = str(src["shipment_line_id"])
            lines[key] = lines.get(key, 0) + take
        label = label or src
        remaining -= take

    if to_container is not None and label is not None:
        _log_box_add(
            connection, to_container, label=label, qty=n, quality=placed_quality,
            source="зоны упаковки", user_id=user_id,
        )

    item = ContainerPlacedItem(
        product_name=(label or {}).get("product_name"),
        product_sku=(label or {}).get("product_sku"),
        color_name=(label or {}).get("color_name"),
        size_name=(label or {}).get("size_name"),
        quality=placed_quality, qty=n, from_collected=True,
    )
    return item.model_dump(), lines


def _take_from_container(
    connection, box, *, variant: dict, qty: int, zone: tuple[str, str], user_id: str, to_container=None,
) -> dict:
    """Товар из размещённого короба: на полку (в т.ч. ту же — это изъятие) или в другой короб.

    Ручные операции с содержимым короба запрещены (иначе короб и остатки разойдутся),
    поэтому единственный путь товара из короба — через ось короба в журнале: снять
    её у источника и, если несут в другой короб, поставить у приёмника.
    """
    from modules.balances.service import insert_inventory_move

    container_id = str(box["id"])
    n = int(qty or 0)
    if n <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество больше нуля")
    if to_container is not None and str(to_container["id"]) == container_id:
        raise HTTPException(status_code=400, detail="Источник и приёмник — один и тот же короб")

    stock = [
        r for r in container_stock_rows(connection, container_id)
        if r["product_id"] == variant["product_id"]
        and (r["color_id"] or None) == (variant["color_id"] or None)
        and (r["size_id"] or None) == (variant["size_id"] or None)
    ]
    available = sum(r["net"] for r in stock)
    if available < n:
        raise HTTPException(
            status_code=400,
            detail=f"В коробе {box['doc_number']} этого товара только {available} шт.",
        )

    to_zone_id, to_zone_name = zone
    same_place = to_container is None and all(r["zone_id"] == to_zone_id for r in stock)
    remaining = n
    label = None
    for r in stock:
        if remaining <= 0:
            break
        take = min(remaining, r["net"])
        if to_container is not None:
            _ensure_box_accepts(connection, to_container, r["quality"])
        if to_container is not None:
            comment = f"Из короба {box['doc_number']} в короб {to_container['doc_number']}: {take} шт."
        elif same_place:
            comment = f"Изъятие из короба {box['doc_number']}: {take} шт. остаются в месте {r['zone_name'] or '—'}"
        else:
            comment = f"Из короба {box['doc_number']}: {take} шт. → {to_zone_name}"
        insert_inventory_move(
            connection,
            product_id=r["product_id"], product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=r["client_id"], client_name=r["client_name"],
            from_op=r["op"], to_op=r["op"],
            from_quality=r["quality"], to_quality=r["quality"],
            from_zone_id=r["zone_id"], from_zone_name=r["zone_name"],
            to_zone_id=to_zone_id, to_zone_name=to_zone_name,
            qty=take, user_id=user_id,
            from_container_id=container_id,
            to_container_id=str(to_container["id"]) if to_container is not None else None,
            shipment_line_id=r["shipment_line_id"],
            comment=comment,
        )
        log_container_op(
            connection, container_id=container_id, op_type=CONTAINER_OP_ITEM_REMOVE, user_id=user_id,
            doc_id=box["doc_id"], product_id=r["product_id"], product_name=r["product_name"],
            product_sku=r["product_sku"], color_name=r["color_name"], size_name=r["size_name"],
            qty=take, zone_id=r["zone_id"], zone_name=r["zone_name"],
            comment=(
                f"Изъятие из размещённого короба: -{take} шт."
                if same_place else
                f"Из короба: -{take} шт. → {to_container['doc_number'] if to_container is not None else to_zone_name}"
            ),
        )
        if to_container is not None:
            _log_box_add(
                connection, to_container, label=r, qty=take, quality=r["quality"],
                source=f"короба {box['doc_number']}", user_id=user_id,
            )
        label = label or r
        remaining -= take

    return ContainerPlacedItem(
        product_name=(label or {}).get("product_name"),
        product_sku=(label or {}).get("product_sku"),
        color_name=(label or {}).get("color_name"),
        size_name=(label or {}).get("size_name"),
        quality=(label or {}).get("quality") or INV_Q_GOOD, qty=n, from_collected=False,
    ).model_dump()



def _scan_variant(connection, scan) -> dict:
    """Позиция скана: ШК с ТСД либо явный вариант из веба (там сканера нет)."""
    from modules.shipments.service import variant_by_barcode

    code = (getattr(scan, "barcode", None) or "").strip()
    if code:
        return variant_by_barcode(connection, code)
    product_id = (getattr(scan, "product_id", None) or "").strip()
    if not product_id:
        raise HTTPException(status_code=400, detail="Укажите товар: отсканируйте штрих-код или выберите позицию")
    return {
        "product_id": product_id,
        "color_id": (getattr(scan, "color_id", None) or None),
        "size_id": (getattr(scan, "size_id", None) or None),
    }


def _log_aside_placement(
    connection, by_line: dict[str, int], *, zone: tuple[str, str], user_id: str,
) -> None:
    """След в журнале задачи о собранном мимо короба: у него нет короба со своей историей."""
    from modules.shipments.service import log_placement_op

    if not by_line:
        return
    rows = connection.execute(
        "SELECT id, doc_id FROM shipment_lines WHERE id = ANY(?)", (list(by_line),)
    ).fetchall()
    by_doc: dict[str, int] = {}
    for r in rows:
        doc_id = str(r["doc_id"])
        by_doc[doc_id] = by_doc.get(doc_id, 0) + by_line.get(str(r["id"]), 0)
    for doc_id, qty in sorted(by_doc.items()):
        log_placement_op(
            connection, doc_id, user_id=user_id,
            comment=f"Размещено без короба: {qty} шт. → {zone[1]}",
        )


def pending_placement(connection) -> ContainerPendingPlacement:
    """Что стоит у стола и ждёт развозки: закрытые короба + упакованное без короба.

    Очередь развозки живёт здесь, а не в задачах: кладовщик везёт ходку тележки, а не
    документ. `since` — самый старый объект в очереди: по нему видно, что забыли.
    """
    box_rows = connection.execute(
        "SELECT id, doc_number, client_name, closed_at, created_at FROM containers "
        "WHERE COALESCE(is_deleted, 0) = 0 AND status = ? ORDER BY doc_number",
        (CONTAINER_STATUS_CLOSED,),
    ).fetchall()
    box_ids = [str(r["id"]) for r in box_rows]
    qty_by_box = containers_items_qty(connection, box_ids) if box_ids else {}

    aside_rows = connection.execute(
        f"""
        WITH moves AS (
            SELECT product_id, color_id, size_id, product_name, product_sku,
                   color_name, size_name, client_name,
                   to_quality AS quality, qty AS net, created_at
            FROM zone_relocations WHERE to_op = ? AND to_container_id IS NULL AND {_PUTAWAY_LINE_SQL}
            UNION ALL
            SELECT product_id, color_id, size_id, product_name, product_sku,
                   color_name, size_name, client_name,
                   from_quality, -qty, created_at
            FROM zone_relocations WHERE from_op = ? AND from_container_id IS NULL AND {_PUTAWAY_LINE_SQL}
        )
        SELECT product_id, color_id, size_id, quality,
               MIN(product_name) AS product_name, MIN(product_sku) AS product_sku,
               MIN(color_name) AS color_name, MIN(size_name) AS size_name,
               MIN(client_name) AS client_name, MIN(created_at) AS since,
               SUM(net) AS net
        FROM moves
        GROUP BY product_id, color_id, size_id, quality
        HAVING SUM(net) > 0
        ORDER BY MIN(product_name)
        """,
        (INV_OP_PACKED, INV_OP_PACKED),
    ).fetchall()
    aside = [
        ContainerPendingAsideItem(
            product_id=str(r["product_id"]), product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_name=r["client_name"], quality=str(r["quality"]), qty=int(r["net"] or 0),
        )
        for r in aside_rows
    ]

    stamps = [str(r["closed_at"] or r["created_at"]) for r in box_rows if (r["closed_at"] or r["created_at"])]
    stamps += [str(r["since"]) for r in aside_rows if r["since"]]
    return ContainerPendingPlacement(
        boxes=[
            ContainerPendingBox(
                id=str(r["id"]), doc_number=str(r["doc_number"]), client_name=r["client_name"],
                items_qty=qty_by_box.get(str(r["id"]), 0), closed_at=r["closed_at"],
            )
            for r in box_rows
        ],
        boxes_qty=sum(qty_by_box.values()),
        aside=aside,
        aside_qty=sum(i.qty for i in aside),
        since=min(stamps) if stamps else None,
    )


def _resolve_target(connection, *, zone_id: str | None, target) -> tuple[tuple[str, str], Any]:
    """«Куда»: место хранения либо размещённый короб. → ((zone_id, zone_name), короб | None)."""
    if target is not None and target.kind == "container":
        box = require_container(connection, str(target.id))
        if str(box["status"]) != CONTAINER_STATUS_PLACED:
            raise HTTPException(
                status_code=400,
                detail=f"Короб {box['doc_number']} ещё не размещён — докладывать можно только в короб на месте",
            )
        return (str(box["zone_id"]), str(box["zone_name"])), box
    zid = str(target.id) if target is not None else (zone_id or "")
    return require_location(connection, zid, empty_detail="Отсканируйте место хранения"), None


def _resolve_source(connection, source) -> tuple[str | None, tuple[str, str] | None, Any]:
    """«Откуда»: (kind, место, короб). Без источника — старое поведение, всё выводится само."""
    if source is None:
        return None, None, None
    if source.kind == "collected":
        return "collected", None, None
    if source.kind == "location":
        zone = require_location(connection, str(source.id or ""), empty_detail="Отсканируйте место, откуда берёте")
        return "location", zone, None
    box = require_container(connection, str(source.id or ""))
    if str(box["status"]) != CONTAINER_STATUS_PLACED:
        raise HTTPException(
            status_code=400,
            detail=f"Короб {box['doc_number']} ещё не размещён — его состав меняют в задаче сборки",
        )
    return "container", None, box


def _check_box_source(box, *, kind: str | None, src_zone: tuple[str, str] | None) -> None:
    """Сверка учёта: короб должен числиться там, откуда его берут. Расхождение — ошибка, не правка."""
    status = str(box["status"])
    if kind == "container":
        raise HTTPException(status_code=400, detail="Из короба берут только товар — короб в коробе не лежит")
    if kind == "collected" and status == CONTAINER_STATUS_PLACED:
        raise HTTPException(
            status_code=400,
            detail=f"Короб {box['doc_number']} уже стоит в месте {box['zone_name'] or '—'} — укажите это место как источник",
        )
    if kind == "location" and src_zone is not None:
        if status == CONTAINER_STATUS_CLOSED:
            raise HTTPException(
                status_code=400,
                detail=f"Короб {box['doc_number']} ещё у стола — источник «Зона упаковки»",
            )
        if str(box["zone_id"] or "") != src_zone[0]:
            raise HTTPException(
                status_code=400,
                detail=f"Короб {box['doc_number']} числится в месте {box['zone_name'] or '—'}, а не {src_zone[1]}",
            )


def place_batch(
    connection, *, zone_id: str | None, box_ids: list[str], items: list[ContainerPlaceItemScan], user_id: str,
    source=None, target=None,
) -> ContainerPlaceResult:
    """Пачка коробов и/или товара в одно место — одна ходка кладовщика («откуда → что → куда»).

    Один эндпоинт на все перемещения по складу: закрытый короб размещается,
    размещённый переезжает, товар едет со стола, с полки или из короба — на полку или
    в размещённый короб. Источник, если назван, ещё и сверяется с учётом. Статусы
    задач развозка не двигает: задача закончилась на сборке, ходка ей не принадлежит.
    """
    # Один короб в пачке ровно один раз: повтор скана на ТСД иначе положил бы короб на
    # место, а вторым проходом попытался его же туда перенести — вся ходка падала бы.
    boxes: list[str] = []
    for raw in box_ids or []:
        box_id = str(raw).strip()
        if box_id and box_id not in boxes:
            boxes.append(box_id)
    scans = list(items or [])
    if not boxes and not scans:
        raise HTTPException(status_code=400, detail="Отсканируйте короб или товар")

    zone, target_box = _resolve_target(connection, zone_id=zone_id, target=target)
    src_kind, src_zone, src_box = _resolve_source(connection, source)

    if target_box is not None and boxes:
        raise HTTPException(status_code=400, detail="Короб в короб не вкладывается")
    if src_kind == "location" and target_box is None and src_zone is not None and src_zone[0] == zone[0]:
        raise HTTPException(status_code=400, detail="Источник и приёмник совпадают")

    placed_qty = 0
    placed_boxes: list[ContainerItem] = []
    placed_items: list[dict] = []
    aside_by_line: dict[str, int] = {}

    for container_id in boxes:
        box = require_container(connection, container_id)
        status = str(box["status"])
        if status in (CONTAINER_STATUS_NEW, CONTAINER_STATUS_OPEN):
            raise HTTPException(
                status_code=400,
                detail=f"Короб {box['doc_number']} ещё не закрыт — закройте его в задаче сборки",
            )
        _check_box_source(box, kind=src_kind, src_zone=src_zone)
        if status == CONTAINER_STATUS_CLOSED:
            placed_qty += _place_closed_box(connection, box, zone, user_id)
        else:  # уже стоит на месте — это перенос
            moved = move_placed_container(connection, container_id, zone[0], user_id)
            placed_qty += moved.items_qty
        placed_boxes.append(container_item(connection, container_id))

    for scan in scans:
        variant = _scan_variant(connection, scan)
        n = int(scan.qty)
        if src_kind == "container":
            item = _take_from_container(
                connection, src_box, variant=variant, qty=n, zone=zone, user_id=user_id, to_container=target_box,
            )
            lines: dict[str, int] = {}
        else:
            from_zone_id = src_zone[0] if src_kind == "location" else ((scan.from_zone_id or "").strip() or None)
            item, lines = _place_aside_item(
                connection, variant=variant, qty=n, quality=scan.quality,
                from_zone_id=from_zone_id, zone=zone, user_id=user_id,
                collected_only=(src_kind == "collected"), to_container=target_box,
            )
        placed_items.append(item)
        for line_id, moved in lines.items():
            aside_by_line[line_id] = aside_by_line.get(line_id, 0) + moved
        placed_qty += int(item["qty"])

    _log_aside_placement(connection, aside_by_line, zone=zone, user_id=user_id)

    return ContainerPlaceResult(
        zone_id=zone[0], zone_name=zone[1],
        target_container=container_item(connection, str(target_box["id"])) if target_box is not None else None,
        boxes=placed_boxes, items=[ContainerPlacedItem(**i) for i in placed_items],
        placed_qty=placed_qty,
    )


def remove_item_from_placed(connection, container_id: str, *, scan, qty: int, user_id: str) -> ContainerItem:
    """Изъятие позиции из размещённого короба: товар остаётся в месте, но вне короба.

    Пересорт находят и у стеллажа, а ручные операции с содержимым короба запрещены
    (иначе короб и остатки разойдутся). Изъятие снимает ось короба, не двигая товар:
    дальше он живёт обычной россыпью в том же месте.
    """
    row = require_container(connection, container_id)
    if str(row["status"]) != CONTAINER_STATUS_PLACED:
        raise HTTPException(status_code=400, detail="Изымать можно только из размещённого короба")
    _take_from_container(
        connection, row, variant=_scan_variant(connection, scan), qty=int(qty or 0),
        zone=(str(row["zone_id"]), str(row["zone_name"])), user_id=user_id,
    )
    return container_item(connection, container_id)



def containers_holdings(
    connection, zone_ids: list[str], *,
    product_id: str | None = None, color_id: str | None = None, size_id: str | None = None,
) -> ContainerHoldingsResponse:
    """Раскладка позиций по коробам — чем строка остатка отличается от россыпи.

    Два режима: по местам (страница «По местам» берёт все места страницы одним
    запросом) и по варианту (шторка «Где лежит» из «По товарам»). Корзины идут все,
    где короб бывает: `packed` — короба у стола, `ready` — развезённые в зону
    отгрузки, `storage` — переехавшие на хранение вручную.
    """
    ids = [str(z).strip() for z in (zone_ids or []) if str(z).strip()]
    pid = (product_id or "").strip()
    if not ids and not pid:
        return ContainerHoldingsResponse(items=[])

    ops = [INV_OP_STORAGE, INV_OP_PACKED, INV_OP_READY]

    def side(prefix: str, sign: str) -> tuple[str, list[Any]]:
        conds = [f"{prefix}_container_id IS NOT NULL", f"{prefix}_op = ANY(?)"]
        params: list[Any] = [ops]
        if ids:
            conds.append(f"{prefix}_zone_id = ANY(?)")
            params.append(ids)
        if pid:
            conds += ["product_id = ?", "color_id IS NOT DISTINCT FROM ?", "size_id IS NOT DISTINCT FROM ?"]
            params += [pid, (color_id or None), (size_id or None)]
        sql = (
            f"SELECT {prefix}_container_id AS container_id, {prefix}_zone_id AS zone_id, "
            f"product_id, color_id, size_id, client_id, {prefix}_quality AS quality, "
            f"{prefix}_op AS op_status, {sign}qty AS net "
            "FROM zone_relocations WHERE " + " AND ".join(conds)
        )
        return sql, params

    to_sql, to_params = side("to", "")
    from_sql, from_params = side("from", "-")
    rows = connection.execute(
        f"""
        SELECT t.zone_id, z.name AS zone_name, t.product_id, t.color_id, t.size_id, t.client_id,
               t.quality, t.op_status, c.id AS container_id, c.doc_number, c.status, SUM(t.net) AS net
        FROM ({to_sql} UNION ALL {from_sql}) t
        JOIN containers c ON c.id = t.container_id
        LEFT JOIN unloading_zones z ON z.id = t.zone_id
        GROUP BY t.zone_id, z.name, t.product_id, t.color_id, t.size_id, t.client_id,
                 t.quality, t.op_status, c.id, c.doc_number, c.status
        HAVING SUM(t.net) > 0
        ORDER BY c.doc_number
        """,
        [*to_params, *from_params],
    ).fetchall()
    return ContainerHoldingsResponse(items=[
        ContainerHoldingRow(
            zone_id=str(r["zone_id"]), zone_name=r["zone_name"],
            product_id=str(r["product_id"]),
            color_id=r["color_id"], size_id=r["size_id"], client_id=r["client_id"],
            quality=str(r["quality"]), op_status=str(r["op_status"]),
            container_id=str(r["container_id"]), doc_number=str(r["doc_number"]),
            status=str(r["status"]), qty=int(r["net"] or 0),
        )
        for r in rows
    ])
