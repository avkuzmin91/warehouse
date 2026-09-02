from __future__ import annotations

from typing import Any, Mapping
from uuid import uuid4

from fastapi import HTTPException

from config import (
    CONTAINER_BATCH_MAX,
    CONTAINER_OP_CREATE,
    CONTAINER_OP_MOVE,
    CONTAINER_QR_PREFIX,
    CONTAINER_STATUS_NEW,
    CONTAINER_STATUS_PLACED,
    INV_OP_STORAGE,
    LOCATION_KIND_CELL,
)
from dbconn import ci_like_substring_param
from utils import next_doc_number as _next_doc_number, now_iso as _now, qr_svg

from .schemas import (
    ContainerContentLine,
    ContainerItem,
    ContainerLabel,
    ContainerLabelsResponse,
    ContainerListResponse,
    ContainerLookupResponse,
    ContainerOpItem,
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
        key = (r["product_id"], r["color_id"], r["size_id"])
        line = agg.get(key)
        if line is None:
            agg[key] = ContainerContentLine(
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


def require_cell(connection, zone_id: str) -> tuple[str, str]:
    """Валидация места назначения короба: активная адресная ячейка. → (id, name)."""
    zid = (zone_id or "").strip()
    if not zid:
        raise HTTPException(status_code=400, detail="Отсканируйте ячейку стеллажа")
    row = connection.execute(
        "SELECT id, name, kind, is_active FROM unloading_zones "
        "WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (zid,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Место не найдено")
    if str(row["kind"] or "") != LOCATION_KIND_CELL:
        raise HTTPException(status_code=400, detail="Короб можно поставить только в адресную ячейку стеллажа")
    if not int(row["is_active"] or 0):
        raise HTTPException(status_code=400, detail="Ячейка отключена — выберите другую")
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
    to_zone_id, to_zone_name = require_cell(connection, zone_id)
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
) -> list[str]:
    """Номера коробов, в которых сейчас лежит позиция в этом месте (нетто > 0).

    Гейт ручных операций с остатками: товар, лежащий в коробе, нельзя двигать или
    списывать «мимо короба» — иначе содержимое короба разойдётся с остатками.
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
    return [str(r["doc_number"]) for r in rows]
