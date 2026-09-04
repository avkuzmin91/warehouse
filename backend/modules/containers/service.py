from __future__ import annotations

from typing import Any, Mapping
from uuid import uuid4

from fastapi import HTTPException

from config import (
    CONTAINER_BATCH_MAX,
    CONTAINER_OP_CREATE,
    CONTAINER_OP_ITEM_REMOVE,
    CONTAINER_OP_MOVE,
    CONTAINER_OP_PLACE,
    CONTAINER_QR_PREFIX,
    CONTAINER_STATUS_CLOSED,
    CONTAINER_STATUS_NEW,
    CONTAINER_STATUS_OPEN,
    CONTAINER_STATUS_PLACED,
    INV_OP_BOXED,
    INV_OP_STORAGE,
    INV_Q_DEFECT,
    INV_Q_GOOD,
)
from dbconn import ci_like_substring_param
from utils import next_doc_number as _next_doc_number, now_iso as _now, qr_svg

from .schemas import (
    ContainerContentLine,
    ContainerHoldingRow,
    ContainerHoldingsResponse,
    ContainerItem,
    ContainerLabel,
    ContainerLabelsResponse,
    ContainerListResponse,
    ContainerLookupResponse,
    ContainerOpItem,
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
    """Содержимое короба, свёрнутое по позициям (для карточки и ТСД)."""
    agg: dict[tuple, ContainerContentLine] = {}
    for r in container_stock_rows(connection, container_id):
        key = (r["shipment_line_id"], r["product_id"], r["color_id"], r["size_id"])
        line = agg.get(key)
        if line is None:
            agg[key] = ContainerContentLine(
                line_id=r["shipment_line_id"],
                product_id=r["product_id"], product_name=r["product_name"], product_sku=r["product_sku"],
                color_id=r["color_id"], color_name=r["color_name"],
                size_id=r["size_id"], size_name=r["size_name"], qty=r["net"],
            )
        else:
            line.qty += r["net"]
    return list(agg.values())


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


def list_containers(
    connection, *, page: int, limit: int,
    status: str | None = None, client_id: str | None = None,
    doc_id: str | None = None, zone_id: str | None = None, search: str | None = None,
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
    if search and search.strip():
        s = ci_like_substring_param(search)
        conds.append("(fold_ci(c.doc_number) LIKE ? OR fold_ci(c.zone_name) LIKE ? OR fold_ci(c.client_name) LIKE ?)")
        params += [s, s, s]
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS n {_FROM_SQL} WHERE {where}", params
    ).fetchone()["n"])
    offset = (page - 1) * limit
    rows = connection.execute(
        f"SELECT {_SELECT_COLS} {_FROM_SQL} WHERE {where} "
        "ORDER BY c.created_at DESC, c.doc_number DESC LIMIT ? OFFSET ?",
        [*params, limit, offset],
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


# ── Размещение: собранное едет из «Ждёт размещения» в место хранения ───────────

def _place_closed_box(connection, box, zone: tuple[str, str], user_id: str) -> int:
    """Короб уехал на стеллаж: boxed → storage в отсканированное место. → сколько штук.

    Это и есть момент готовности товара: пока короб стоит у стола, он не доступен ни
    отгрузке, ни другой задаче упаковки.
    """
    from modules.balances.service import insert_inventory_move
    from modules.shipments.service import log_placement_op

    container_id = str(box["id"])
    stock = [r for r in container_stock_rows(connection, container_id) if r["op"] == INV_OP_BOXED]
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
            from_op=INV_OP_BOXED, to_op=INV_OP_STORAGE,
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


def _aside_sources(connection, variant: dict, quality: str | None) -> list[dict]:
    """Собранное мимо коробов по варианту: строки задания, где нетто boxed > 0.

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
            WHERE to_op = '{INV_OP_BOXED}' AND to_container_id IS NULL
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ?::text AND size_id IS NOT DISTINCT FROM ?::text
            UNION ALL
            SELECT shipment_line_id, product_id, color_id, size_id, client_id,
                   product_name, product_sku, color_name, size_name, client_name,
                   from_quality, from_zone_id, from_zone_name, -qty
            FROM zone_relocations
            WHERE from_op = '{INV_OP_BOXED}' AND from_container_id IS NULL
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
            detail="По этому товару размещения ждут и годный, и брак — укажите качество",
        )
    return sources


def free_storage_sources(connection, variant: dict, quality: str | None, zone_id: str | None) -> list[dict]:
    """Свободный (вне коробов) остаток позиции на хранении: по местам и качеству.

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
                   to_quality AS quality, to_zone_id AS zone_id, to_zone_name AS zone_name, qty AS net
            FROM zone_relocations
            WHERE to_op = '{INV_OP_STORAGE}' AND to_container_id IS NULL
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ?::text AND size_id IS NOT DISTINCT FROM ?::text
              {conds}
            UNION ALL
            SELECT product_id, color_id, size_id, client_id,
                   product_name, product_sku, color_name, size_name, client_name,
                   from_quality, from_zone_id, from_zone_name, -qty
            FROM zone_relocations
            WHERE from_op = '{INV_OP_STORAGE}' AND from_container_id IS NULL
              AND product_id = ? AND color_id IS NOT DISTINCT FROM ?::text AND size_id IS NOT DISTINCT FROM ?::text
              {conds.replace('to_zone_id', 'from_zone_id')}
        )
        SELECT product_id, color_id, size_id, client_id, quality, zone_id,
               MIN(product_name) AS product_name, MIN(product_sku) AS product_sku,
               MIN(color_name) AS color_name, MIN(size_name) AS size_name,
               MIN(client_name) AS client_name, MIN(zone_name) AS zone_name,
               SUM(net) AS net
        FROM moves
        GROUP BY product_id, color_id, size_id, client_id, quality, zone_id
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
            "quality": str(r["quality"]), "zone_id": r["zone_id"], "zone_name": r["zone_name"],
            "net": int(r["net"] or 0),
        }
        for r in rows
    ]
    if quality:
        return [r for r in sources if r["quality"] == quality]
    return sources


def _move_from_storage(
    connection, *, sources: list[dict], qty: int, zone: tuple[str, str], user_id: str,
) -> dict:
    """Перенос товара с полки: storage@источник → storage@назначение. → строка ответа.

    Считает и пишет движения общий код ручного перемещения (`balances`): там живут
    гейт короба, проверка остатка и дробление по атрибуции к строкам документов.
    """
    from types import SimpleNamespace

    from modules.balances.service import _create_relocation_moves

    to_zone_id, to_zone_name = zone
    remaining = qty
    label = None
    for src in sources:
        if remaining <= 0:
            break
        if src["zone_id"] == to_zone_id:
            continue  # уже стоит там, куда несут
        take = min(remaining, src["net"])
        _create_relocation_moves(
            connection,
            SimpleNamespace(
                product_id=src["product_id"], product_name=src["product_name"], product_sku=src["product_sku"],
                color_id=src["color_id"], color_name=src["color_name"],
                size_id=src["size_id"], size_name=src["size_name"],
                client_id=src["client_id"], client_name=src["client_name"],
                op=INV_OP_STORAGE, quality=src["quality"],
                from_zone_id=src["zone_id"], to_zone_id=to_zone_id,
                qty=take, comment=f"Перенос: {src['zone_name'] or 'без места'} → {to_zone_name}",
            ),
            user_id,
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
    zone: tuple[str, str], user_id: str,
) -> tuple[dict, set[str]]:
    """Скан товара: собранное едет на место, лежащее на полке — переносится.

    Что именно взято, решает не режим экрана, а сам товар: сначала смотрим, не ждёт
    ли он размещения (корзина boxed), иначе берём свободный остаток на хранении.
    Пустой набор задач во втором случае — перенос ничью задачу не закрывает.
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
        storage = free_storage_sources(connection, variant, q, from_zone_id)
        if not storage:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Этот товар нигде не числится свободным — проверьте, что сканируете"
                    if not from_zone_id else
                    "В этом месте такого товара нет (или он лежит в коробе — тогда несите короб)"
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
        return _move_from_storage(connection, sources=storage, qty=n, zone=zone, user_id=user_id), set()

    available = sum(r["net"] for r in sources)
    if available < n:
        raise HTTPException(
            status_code=400,
            detail=f"Размещения ждёт только {available} шт. этого товара — проверьте, что сканируете",
        )

    to_zone_id, to_zone_name = zone
    lines: set[str] = set()
    remaining = n
    placed_quality = q or (sources[0]["quality"] if sources else INV_Q_GOOD)
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
            from_op=INV_OP_BOXED, to_op=INV_OP_STORAGE,
            from_quality=src["quality"], to_quality=src["quality"],
            from_zone_id=src["zone_id"], from_zone_name=src["zone_name"],
            to_zone_id=to_zone_id, to_zone_name=to_zone_name,
            qty=take, user_id=user_id, shipment_line_id=src["shipment_line_id"],
            comment=f"Размещение мимо короба: {take} шт → {to_zone_name}",
        )
        if src["shipment_line_id"]:
            lines.add(str(src["shipment_line_id"]))
        label = label or src
        remaining -= take

    item = ContainerPlacedItem(
        product_name=(label or {}).get("product_name"),
        product_sku=(label or {}).get("product_sku"),
        color_name=(label or {}).get("color_name"),
        size_name=(label or {}).get("size_name"),
        quality=placed_quality, qty=n, from_collected=True,
    )
    return item.model_dump(), lines


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


def place_batch(
    connection, *, zone_id: str, box_ids: list[str], items: list[ContainerPlaceItemScan], user_id: str,
) -> ContainerPlaceResult:
    """Пачка коробов и/или товара в одно место хранения — одна ходка кладовщика.

    Один экран и один запрос на все перемещения по складу: короб решает сам, что с
    ним делать (закрытый — размещается, размещённый — переезжает), товар — тоже
    (ждёт размещения — уезжает на место, лежит на полке — переносится). Задачи
    размещения закрываются автоматически, когда уехал их последний объект.
    """
    from modules.shipments.service import maybe_close_putaway_doc

    boxes = [str(b).strip() for b in (box_ids or []) if str(b).strip()]
    scans = list(items or [])
    if not boxes and not scans:
        raise HTTPException(status_code=400, detail="Отсканируйте короб или товар")

    zone = require_location(connection, zone_id, empty_detail="Отсканируйте место хранения")
    placed_qty = 0
    placed_boxes: list[ContainerItem] = []
    placed_items: list[dict] = []
    doc_ids: set[str] = set()
    line_ids: set[str] = set()

    for container_id in boxes:
        box = require_container(connection, container_id)
        status = str(box["status"])
        if status in (CONTAINER_STATUS_NEW, CONTAINER_STATUS_OPEN):
            raise HTTPException(
                status_code=400,
                detail=f"Короб {box['doc_number']} ещё не закрыт — закройте его в задаче сборки",
            )
        if status == CONTAINER_STATUS_CLOSED:
            placed_qty += _place_closed_box(connection, box, zone, user_id)
        else:  # уже стоит на месте — это перенос
            moved = move_placed_container(connection, container_id, zone[0], user_id)
            placed_qty += moved.items_qty
        if box["doc_id"]:
            doc_ids.add(str(box["doc_id"]))
        placed_boxes.append(container_item(connection, container_id))

    for scan in scans:
        item, lines = _place_aside_item(
            connection, variant=_scan_variant(connection, scan), qty=int(scan.qty), quality=scan.quality,
            from_zone_id=(scan.from_zone_id or "").strip() or None,
            zone=zone, user_id=user_id,
        )
        placed_items.append(item)
        line_ids |= lines
        placed_qty += int(item["qty"])

    if line_ids:
        rows = connection.execute(
            "SELECT DISTINCT doc_id FROM shipment_lines WHERE id = ANY(?)", (list(line_ids),)
        ).fetchall()
        doc_ids |= {str(r["doc_id"]) for r in rows}

    closed_tasks: list[str] = []
    for doc_id in sorted(doc_ids):
        if maybe_close_putaway_doc(connection, doc_id, user_id):
            row = connection.execute(
                "SELECT doc_number FROM shipment_docs WHERE id = ?", (doc_id,)
            ).fetchone()
            if row:
                closed_tasks.append(str(row["doc_number"]))

    return ContainerPlaceResult(
        zone_id=zone[0], zone_name=zone[1],
        boxes=placed_boxes, items=[ContainerPlacedItem(**i) for i in placed_items],
        placed_qty=placed_qty, closed_tasks=closed_tasks,
    )


def remove_item_from_placed(connection, container_id: str, *, scan, qty: int, user_id: str) -> ContainerItem:
    """Изъятие позиции из размещённого короба: товар остаётся в месте, но вне короба.

    Пересорт находят и у стеллажа, а ручные операции с содержимым короба запрещены
    (иначе короб и остатки разойдутся). Изъятие снимает ось короба, не двигая товар:
    дальше он живёт обычной россыпью в том же месте.
    """
    from modules.balances.service import insert_inventory_move

    row = require_container(connection, container_id)
    if str(row["status"]) != CONTAINER_STATUS_PLACED:
        raise HTTPException(status_code=400, detail="Изымать можно только из размещённого короба")
    n = int(qty or 0)
    if n <= 0:
        raise HTTPException(status_code=400, detail="Укажите количество больше нуля")

    variant = _scan_variant(connection, scan)
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
            detail=f"В коробе {row['doc_number']} этого товара только {available} шт.",
        )

    remaining = n
    for r in stock:
        if remaining <= 0:
            break
        take = min(remaining, r["net"])
        insert_inventory_move(
            connection,
            product_id=r["product_id"], product_name=r["product_name"], product_sku=r["product_sku"],
            color_id=r["color_id"], color_name=r["color_name"],
            size_id=r["size_id"], size_name=r["size_name"],
            client_id=r["client_id"], client_name=r["client_name"],
            from_op=r["op"], to_op=r["op"],
            from_quality=r["quality"], to_quality=r["quality"],
            from_zone_id=r["zone_id"], from_zone_name=r["zone_name"],
            to_zone_id=r["zone_id"], to_zone_name=r["zone_name"],
            qty=take, user_id=user_id,
            from_container_id=container_id, to_container_id=None,
            shipment_line_id=r["shipment_line_id"],
            comment=f"Изъятие из короба {row['doc_number']}: {take} шт. остаются в месте {r['zone_name'] or '—'}",
        )
        log_container_op(
            connection, container_id=container_id, op_type=CONTAINER_OP_ITEM_REMOVE, user_id=user_id,
            doc_id=row["doc_id"], product_id=r["product_id"], product_name=r["product_name"],
            product_sku=r["product_sku"], color_name=r["color_name"], size_name=r["size_name"],
            qty=take, zone_id=r["zone_id"], zone_name=r["zone_name"],
            comment=f"Изъятие из размещённого короба: -{take} шт.",
        )
        remaining -= take

    return container_item(connection, container_id)


def containers_holdings(connection, zone_ids: list[str]) -> ContainerHoldingsResponse:
    """Что из позиций лежит в коробах в указанных местах — для бейджа в остатках.

    Одним запросом на страницу остатков: иначе кладовщик видит остаток, жмёт
    «переместить» и упирается в отказ гейта, не понимая причины.
    """
    ids = [str(z).strip() for z in (zone_ids or []) if str(z).strip()]
    if not ids:
        return ContainerHoldingsResponse(items=[])
    rows = connection.execute(
        f"""
        SELECT t.zone_id, t.product_id, t.color_id, t.size_id, t.client_id, t.quality,
               c.doc_number, SUM(t.net) AS net
        FROM (
            SELECT to_container_id AS container_id, to_zone_id AS zone_id, product_id, color_id, size_id,
                   client_id, to_quality AS quality, qty AS net
            FROM zone_relocations
            WHERE to_container_id IS NOT NULL AND to_op = '{INV_OP_STORAGE}' AND to_zone_id = ANY(?)
            UNION ALL
            SELECT from_container_id, from_zone_id, product_id, color_id, size_id,
                   client_id, from_quality, -qty
            FROM zone_relocations
            WHERE from_container_id IS NOT NULL AND from_op = '{INV_OP_STORAGE}' AND from_zone_id = ANY(?)
        ) t
        JOIN containers c ON c.id = t.container_id
        GROUP BY t.zone_id, t.product_id, t.color_id, t.size_id, t.client_id, t.quality, c.doc_number
        HAVING SUM(t.net) > 0
        ORDER BY c.doc_number
        """,
        (ids, ids),
    ).fetchall()
    return ContainerHoldingsResponse(items=[
        ContainerHoldingRow(
            zone_id=str(r["zone_id"]), product_id=str(r["product_id"]),
            color_id=r["color_id"], size_id=r["size_id"], client_id=r["client_id"],
            quality=str(r["quality"]), doc_number=str(r["doc_number"]), qty=int(r["net"] or 0),
        )
        for r in rows
    ])
