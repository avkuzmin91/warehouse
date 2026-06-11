from __future__ import annotations

from fastapi import HTTPException, status

from config import (
    CABINET_RECEIPT_OPS_VISIBLE,
    CABINET_RECEIPT_VISIBLE_STATUSES,
    CABINET_SHIPMENT_OPS_VISIBLE,
    CABINET_SHIPMENT_VISIBLE_STATUSES,
    PRODUCT_LIST_SORT_COLUMNS,
    RECEIPT_STATUS_ON_INTAKE,
    RECEIPT_STATUS_PLANNED,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_STATUS_AWAITING_TRIP,
    SHIPMENT_STATUS_ON_PACKING,
    SHIPMENT_STATUS_PACKING,
    SHIPMENT_STATUS_RELOCATING,
)
from dbconn import like_substring_param
from modules.cabinet.schemas import (
    CabinetBalanceTotals,
    CabinetEventItem,
    CabinetLineFile,
    CabinetOpItem,
    CabinetPackingReportDay,
    CabinetPackingReportResponse,
    CabinetPackingReportRow,
    CabinetProfileResponse,
    CabinetReceiptDetailResponse,
    CabinetReceiptDoc,
    CabinetReceiptLine,
    CabinetReceiptLineItem,
    CabinetReceiptLinesResponse,
    CabinetReceiptListItem,
    CabinetReceiptListResponse,
    CabinetReceiptTotals,
    CabinetShipmentDetailResponse,
    CabinetShipmentDoc,
    CabinetShipmentLine,
    CabinetShipmentLineItem,
    CabinetShipmentLinesResponse,
    CabinetShipmentListItem,
    CabinetShipmentListResponse,
    CabinetSummaryResponse,
)
from modules.products.schemas import ProductItem, ProductListResponse, ProductVariantDimension, ProductVariantItem
from modules.products.service import (
    _ci_substring_like_param,
    _decode_images_json,
    _order_sql_from_sort_param,
    _row_to_product_item,
)


def list_cabinet_products(
    connection,
    *,
    client_id: str,
    page: int,
    limit: int,
    search: str | None,
    sort: str | None,
) -> ProductListResponse:
    offset = (page - 1) * limit
    conds = ["p.client_id = ?", "COALESCE(p.is_deleted, 0) = 0"]
    params: list[object] = [client_id]
    if search is not None and str(search).strip():
        like = _ci_substring_like_param(str(search))
        conds.append("(fold_ci(COALESCE(p.name, '')) LIKE ? OR fold_ci(COALESCE(p.sku, '')) LIKE ?)")
        params.extend([like, like])

    join_sql = """
        FROM products p
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN (
            SELECT product_id, COUNT(*) AS cnt
            FROM product_variants
            WHERE COALESCE(is_deleted, 0) = 0
            GROUP BY product_id
        ) vcnt ON vcnt.product_id = p.id
        LEFT JOIN users creator ON creator.id = p.creator_id
        LEFT JOIN users editor ON editor.id = p.updated_by_id
        LEFT JOIN users deleter ON deleter.id = p.deleted_by_id
    """
    where_sql = " AND ".join(conds)
    order_sql = _order_sql_from_sort_param(sort, PRODUCT_LIST_SORT_COLUMNS) or "p.name ASC, p.sku ASC"

    total = int(
        connection.execute(
            f"SELECT COUNT(*) AS cnt {join_sql} WHERE {where_sql}",
            params,
        ).fetchone()["cnt"]
    )
    rows = connection.execute(
        f"""
        SELECT p.id, p.name, p.type_id, pt.name AS type_name, p.sku AS sku_base, p.weight_grams,
               p.items_per_pallet,
               COALESCE(pt.requires_color, 0) AS requires_color,
               COALESCE(pt.requires_size, 0) AS requires_size,
               p.client_id, c.name AS client_name,
               COALESCE(vcnt.cnt, 0) AS variant_count,
               p.is_active, COALESCE(p.is_deleted, 0) AS is_deleted,
               p.deleted_at, p.image_url, p.gallery_json,
               p.created_at, p.updated_at,
               creator.email AS created_by, editor.email AS updated_by, deleter.email AS deleted_by
        {join_sql}
        WHERE {where_sql}
        ORDER BY {order_sql}
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()
    return ProductListResponse(
        items=[_row_to_product_item(row) for row in rows],
        total=total,
        page=page,
        limit=limit,
    )


def get_cabinet_product(connection, *, client_id: str, product_id: str) -> ProductItem:
    row = connection.execute(
        """
        SELECT p.id, p.name, p.type_id, pt.name AS type_name, p.sku AS sku_base, p.weight_grams,
               p.items_per_pallet,
               COALESCE(pt.requires_color, 0) AS requires_color,
               COALESCE(pt.requires_size, 0) AS requires_size,
               p.client_id, c.name AS client_name,
               COALESCE(vcnt.cnt, 0) AS variant_count,
               p.is_active, COALESCE(p.is_deleted, 0) AS is_deleted,
               p.deleted_at, p.image_url, p.gallery_json,
               p.created_at, p.updated_at,
               creator.email AS created_by, editor.email AS updated_by, deleter.email AS deleted_by
        FROM products p
        LEFT JOIN product_types pt ON pt.id = p.type_id
        LEFT JOIN clients c ON c.id = p.client_id
        LEFT JOIN (
            SELECT product_id, COUNT(*) AS cnt
            FROM product_variants
            WHERE COALESCE(is_deleted, 0) = 0
            GROUP BY product_id
        ) vcnt ON vcnt.product_id = p.id
        LEFT JOIN users creator ON creator.id = p.creator_id
        LEFT JOIN users editor ON editor.id = p.updated_by_id
        LEFT JOIN users deleter ON deleter.id = p.deleted_by_id
        WHERE p.id = ?
          AND p.client_id = ?
          AND COALESCE(p.is_deleted, 0) = 0
        """,
        (product_id, client_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Товар не найден")
    return _row_to_product_item(row)


def list_cabinet_product_variants(connection, *, client_id: str, product_id: str) -> list[ProductVariantItem]:
    product = connection.execute(
        """
        SELECT id
        FROM products
        WHERE id = ?
          AND client_id = ?
          AND COALESCE(is_deleted, 0) = 0
        """,
        (product_id, client_id),
    ).fetchone()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Товар не найден")

    rows = connection.execute(
        """
        SELECT v.id, v.color_id, col.name AS color_name,
               v.size_id, sz.name AS size_name,
               v.length, v.width, v.height, v.sku, v.images_json, v.is_active,
               GREATEST(0, COALESCE(b.good_in, 0)) AS stock,
               GREATEST(0, COALESCE(b.defect_in, 0)) AS defect_qty,
               CASE WHEN EXISTS (
                   SELECT 1 FROM receipt_lines rl
                   JOIN receipt_docs rd ON rd.id = rl.doc_id
                   WHERE rl.product_id = v.product_id
                     AND rl.color_id IS NOT DISTINCT FROM v.color_id
                     AND rl.size_id IS NOT DISTINCT FROM v.size_id
                     AND rd.client_id = ?
                     AND rl.is_deleted = 0 AND rd.is_deleted = 0
               ) THEN 1 ELSE 0 END AS has_receipts
        FROM product_variants v
        LEFT JOIN colors col ON col.id = v.color_id
        LEFT JOIN sizes sz ON sz.id = v.size_id
        LEFT JOIN (
            SELECT product_id, color_id, size_id,
                   SUM(CASE WHEN to_quality='good' AND to_op<>'shipped' THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_quality='good' AND from_op<>'intake' THEN qty ELSE 0 END) AS good_in,
                   SUM(CASE WHEN to_quality='defect' AND to_op<>'shipped' THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_quality='defect' AND from_op<>'intake' THEN qty ELSE 0 END) AS defect_in
            FROM zone_relocations
            WHERE product_id = ? AND client_id = ?
            GROUP BY product_id, color_id, size_id
        ) b ON b.product_id = v.product_id AND b.color_id IS NOT DISTINCT FROM v.color_id AND b.size_id IS NOT DISTINCT FROM v.size_id
        WHERE v.product_id = ?
          AND v.client_id = ?
          AND COALESCE(v.is_deleted, 0) = 0
        ORDER BY LOWER(v.sku) ASC
        """,
        (
            client_id,
            product_id,
            client_id,
            product_id,
            client_id,
        ),
    ).fetchall()
    return [
        ProductVariantItem(
            id=str(row["id"]),
            color_id=row["color_id"],
            color_name=row["color_name"],
            dimension=ProductVariantDimension(
                length=float(row["length"]),
                width=float(row["width"]),
                height=float(row["height"]),
            ),
            size_id=str(row["size_id"]) if row["size_id"] else None,
            size_name=row["size_name"],
            sku=str(row["sku"]),
            images=_decode_images_json(row["images_json"]),
            is_active=bool(row["is_active"]),
            stock=max(0, int(row["stock"])),
            defect_qty=max(0, int(row["defect_qty"])),
            has_receipts=bool(row["has_receipts"]),
        )
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Поступления (клиентская проекция)
# ---------------------------------------------------------------------------

def _receipt_status_cond(status: str | None) -> tuple[str, list[str]]:
    allowed = [status] if status else sorted(CABINET_RECEIPT_VISIBLE_STATUSES)
    placeholders = ",".join("?" for _ in allowed)
    return f"d.status IN ({placeholders})", allowed


def _shipment_status_cond(status: str | None) -> tuple[str, list[str]]:
    allowed = [status] if status else sorted(CABINET_SHIPMENT_VISIBLE_STATUSES)
    placeholders = ",".join("?" for _ in allowed)
    return f"d.status IN ({placeholders})", allowed


def list_cabinet_receipts(
    connection,
    *,
    client_id: str,
    page: int,
    limit: int,
    status: str | None = None,
    statuses: list[str] | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    order: str = "recent",
) -> CabinetReceiptListResponse:
    conds = ["d.is_deleted = 0", "d.client_id = ?"]
    params: list = [client_id]
    if statuses:
        placeholders = ",".join("?" for _ in statuses)
        conds.append(f"d.status IN ({placeholders})")
        params.extend(statuses)
    else:
        cond, status_params = _receipt_status_cond(status)
        conds.append(cond)
        params.extend(status_params)
    if search and search.strip():
        s = like_substring_param(search)
        conds.append("d.doc_number LIKE ?")
        params.append(s)
    if date_from:
        conds.append("d.arrival_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?")
        params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS cnt FROM receipt_docs d WHERE {where}", params
    ).fetchone()["cnt"])

    order_sql = (
        "d.arrival_date ASC NULLS LAST, d.created_at"
        if order == "upcoming"
        else "COALESCE(d.actual_arrival_date, d.arrival_date) DESC, d.created_at DESC"
    )
    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT
            d.id, d.doc_number, d.arrival_date, d.actual_arrival_date,
            d.status, d.created_at,
            COUNT(DISTINCT CASE WHEN l.is_deleted = 0 THEN l.id END) AS sku_count,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN l.planned_qty ELSE 0 END), 0) AS total_planned,
            COALESCE(SUM(CASE WHEN l.is_deleted = 0 THEN COALESCE(l.accepted_qty, 0) ELSE 0 END), 0) AS total_accepted_qty
        FROM receipt_docs d
        LEFT JOIN receipt_lines l ON l.doc_id = d.id
        WHERE {where}
        GROUP BY d.id
        ORDER BY {order_sql}
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    items = [
        CabinetReceiptListItem(
            id=str(r["id"]),
            doc_number=str(r["doc_number"]),
            arrival_date=r["arrival_date"],
            actual_arrival_date=r["actual_arrival_date"],
            status=str(r["status"]),
            sku_count=int(r["sku_count"] or 0),
            total_planned=int(r["total_planned"] or 0),
            total_accepted_qty=int(r["total_accepted_qty"] or 0),
            created_at=str(r["created_at"]),
        )
        for r in rows
    ]
    return CabinetReceiptListResponse(items=items, total=total, page=page, limit=limit)


def list_cabinet_receipt_lines(
    connection,
    *,
    client_id: str,
    page: int,
    limit: int,
    status: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> CabinetReceiptLinesResponse:
    conds = ["d.is_deleted = 0", "l.is_deleted = 0", "d.client_id = ?"]
    params: list = [client_id]
    cond, status_params = _receipt_status_cond(status)
    conds.append(cond)
    params.extend(status_params)
    if search and search.strip():
        s = like_substring_param(search)
        conds.append("(l.product_sku LIKE ? OR l.product_name LIKE ? OR d.doc_number LIKE ?)")
        params += [s, s, s]
    if date_from:
        conds.append("d.arrival_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.arrival_date <= ?")
        params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"""SELECT COUNT(*) AS cnt
            FROM receipt_lines l JOIN receipt_docs d ON d.id = l.doc_id
            WHERE {where}""",
        params,
    ).fetchone()["cnt"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT l.doc_id, d.doc_number, d.status, d.arrival_date, d.actual_arrival_date,
               l.product_name, l.product_sku, l.color_name, l.size_name,
               l.planned_qty, l.accepted_qty
        FROM receipt_lines l
        JOIN receipt_docs d ON d.id = l.doc_id
        WHERE {where}
        ORDER BY COALESCE(d.actual_arrival_date, d.arrival_date) DESC, d.created_at DESC, l.created_at
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    items = [
        CabinetReceiptLineItem(
            doc_id=str(r["doc_id"]),
            doc_number=str(r["doc_number"]),
            status=str(r["status"]),
            arrival_date=r["arrival_date"],
            actual_arrival_date=r["actual_arrival_date"],
            product_name=str(r["product_name"]),
            product_sku=str(r["product_sku"]),
            color_name=r["color_name"],
            size_name=r["size_name"],
            planned_qty=int(r["planned_qty"]),
            accepted_qty=int(r["accepted_qty"]) if r["accepted_qty"] is not None else None,
        )
        for r in rows
    ]
    return CabinetReceiptLinesResponse(items=items, total=total, page=page, limit=limit)


def get_cabinet_receipt(connection, *, client_id: str, doc_id: str) -> CabinetReceiptDetailResponse:
    cond, status_params = _receipt_status_cond(None)
    row = connection.execute(
        f"SELECT * FROM receipt_docs d WHERE d.id = ? AND d.client_id = ? AND d.is_deleted = 0 AND {cond}",
        [doc_id, client_id, *status_params],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Документ не найден")

    lines_rows = connection.execute(
        """SELECT product_name, product_sku, color_name, size_name, planned_qty, accepted_qty
           FROM receipt_lines WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at, id""",
        (doc_id,),
    ).fetchall()
    ops_placeholders = ",".join("?" for _ in CABINET_RECEIPT_OPS_VISIBLE)
    ops_rows = connection.execute(
        f"""SELECT op_type, qty, comment, created_at
            FROM receipt_ops WHERE doc_id = ? AND op_type IN ({ops_placeholders})
            ORDER BY created_at DESC""",
        [doc_id, *sorted(CABINET_RECEIPT_OPS_VISIBLE)],
    ).fetchall()

    lines = [
        CabinetReceiptLine(
            product_name=str(l["product_name"]),
            product_sku=str(l["product_sku"]),
            color_name=l["color_name"],
            size_name=l["size_name"],
            planned_qty=int(l["planned_qty"]),
            accepted_qty=int(l["accepted_qty"]) if l["accepted_qty"] is not None else None,
        )
        for l in lines_rows
    ]
    return CabinetReceiptDetailResponse(
        doc=CabinetReceiptDoc(
            id=str(row["id"]),
            doc_number=str(row["doc_number"]),
            arrival_date=row["arrival_date"],
            actual_arrival_date=row["actual_arrival_date"],
            ttn=row["ttn"],
            status=str(row["status"]),
            created_at=str(row["created_at"]),
        ),
        lines=lines,
        ops=[
            CabinetOpItem(
                op_type=str(o["op_type"]),
                qty=int(o["qty"]) if o["qty"] is not None else None,
                comment=o["comment"],
                created_at=str(o["created_at"]),
            )
            for o in ops_rows
        ],
        totals=CabinetReceiptTotals(
            total_planned=sum(l.planned_qty for l in lines),
            total_accepted=sum(l.accepted_qty or 0 for l in lines),
        ),
    )


# ---------------------------------------------------------------------------
# Отгрузки (клиентская проекция)
# ---------------------------------------------------------------------------

# Нетто-упаковка по строке — то же правило, что в карточке отгрузки (router shipments).
_PACKED_SUBQUERY = """
    COALESCE((
        SELECT SUM(CASE
            WHEN zr.to_op='ready' AND COALESCE(zr.from_op,'')<>'ready' THEN zr.qty
            WHEN zr.from_op='ready' AND zr.to_op='packing'             THEN -zr.qty
            ELSE 0 END)
        + SUM(CASE
            WHEN zr.to_quality='defect'   AND COALESCE(zr.from_quality,'')<>'defect' THEN zr.qty
            WHEN zr.from_quality='defect' AND COALESCE(zr.to_quality,'')<>'defect'   THEN -zr.qty
            ELSE 0 END)
        FROM zone_relocations zr
        JOIN shipment_lines sl2 ON sl2.id = zr.shipment_line_id
        WHERE sl2.doc_id = d.id
    ), 0) AS total_packed_qty
"""


def list_cabinet_shipments(
    connection,
    *,
    client_id: str,
    page: int,
    limit: int,
    status: str | None = None,
    statuses: list[str] | None = None,
    cargo_type: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    order: str = "recent",
) -> CabinetShipmentListResponse:
    conds = ["d.is_deleted = 0", "d.client_id = ?"]
    params: list = [client_id]
    if statuses:
        placeholders = ",".join("?" for _ in statuses)
        conds.append(f"d.status IN ({placeholders})")
        params.extend(statuses)
    else:
        cond, status_params = _shipment_status_cond(status)
        conds.append(cond)
        params.extend(status_params)
    if cargo_type in (SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT):
        conds.append("COALESCE(d.cargo_type, 'good') = ?")
        params.append(cargo_type)
    if search and search.strip():
        s = like_substring_param(search)
        conds.append(
            "(d.doc_number LIKE ? OR EXISTS (SELECT 1 FROM shipment_lines sl"
            " WHERE sl.doc_id = d.id AND COALESCE(sl.is_deleted, 0) = 0 AND COALESCE(sl.store_name,'') LIKE ?))"
        )
        params += [s, s]
    if date_from:
        conds.append("d.ship_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.ship_date <= ?")
        params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"SELECT COUNT(*) AS cnt FROM shipment_docs d WHERE {where}", params
    ).fetchone()["cnt"])

    order_sql = (
        "d.ship_date ASC NULLS LAST, d.created_at"
        if order == "upcoming"
        else "d.ship_date DESC NULLS LAST, d.created_at DESC"
    )
    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT d.id, d.doc_number, COALESCE(d.cargo_type, 'good') AS cargo_type,
               d.carrier, d.ship_date, d.actual_ship_date,
               d.status, d.created_at,
               ARRAY_REMOVE(ARRAY_AGG(DISTINCT l.store_name) FILTER (WHERE l.is_deleted = 0), NULL) AS store_names,
               COUNT(l.id) FILTER (WHERE l.is_deleted = 0) AS sku_count,
               COALESCE(SUM(l.qty) FILTER (WHERE l.is_deleted = 0), 0) AS total_qty,
               COALESCE(SUM(COALESCE(l.shipped_qty, 0)) FILTER (WHERE l.is_deleted = 0), 0) AS total_shipped_qty,
               {_PACKED_SUBQUERY}
        FROM shipment_docs d
        LEFT JOIN shipment_lines l ON l.doc_id = d.id
        WHERE {where}
        GROUP BY d.id
        ORDER BY {order_sql}
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    items = [
        CabinetShipmentListItem(
            id=str(r["id"]),
            doc_number=str(r["doc_number"]),
            cargo_type=str(r["cargo_type"]),
            store_names=[str(s) for s in (r["store_names"] or [])],
            carrier=r["carrier"],
            ship_date=r["ship_date"],
            actual_ship_date=r["actual_ship_date"],
            status=str(r["status"]),
            sku_count=int(r["sku_count"] or 0),
            total_qty=int(r["total_qty"] or 0),
            total_packed_qty=int(r["total_packed_qty"] or 0),
            total_shipped_qty=int(r["total_shipped_qty"] or 0),
            created_at=str(r["created_at"]),
        )
        for r in rows
    ]
    return CabinetShipmentListResponse(items=items, total=total, page=page, limit=limit)


def list_cabinet_shipment_lines(
    connection,
    *,
    client_id: str,
    page: int,
    limit: int,
    status: str | None = None,
    cargo_type: str | None = None,
    search: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> CabinetShipmentLinesResponse:
    conds = ["d.is_deleted = 0", "l.is_deleted = 0", "d.client_id = ?"]
    params: list = [client_id]
    cond, status_params = _shipment_status_cond(status)
    conds.append(cond)
    params.extend(status_params)
    if cargo_type in (SHIPMENT_CARGO_GOOD, SHIPMENT_CARGO_DEFECT):
        conds.append("COALESCE(d.cargo_type, 'good') = ?")
        params.append(cargo_type)
    if search and search.strip():
        s = like_substring_param(search)
        conds.append("(l.product_sku LIKE ? OR l.product_name LIKE ? OR d.doc_number LIKE ?)")
        params += [s, s, s]
    if date_from:
        conds.append("d.ship_date >= ?")
        params.append(date_from)
    if date_to:
        conds.append("d.ship_date <= ?")
        params.append(date_to)
    where = " AND ".join(conds)

    total = int(connection.execute(
        f"""SELECT COUNT(*) AS cnt
            FROM shipment_lines l JOIN shipment_docs d ON d.id = l.doc_id
            WHERE {where}""",
        params,
    ).fetchone()["cnt"])

    offset = (page - 1) * limit
    rows = connection.execute(
        f"""
        SELECT l.doc_id, d.doc_number, COALESCE(d.cargo_type, 'good') AS cargo_type,
               d.status, d.ship_date,
               l.product_name, l.product_sku, l.color_name, l.size_name,
               l.qty, l.shipped_qty, l.store_name
        FROM shipment_lines l
        JOIN shipment_docs d ON d.id = l.doc_id
        WHERE {where}
        ORDER BY d.ship_date DESC NULLS LAST, d.created_at DESC, l.created_at
        LIMIT ? OFFSET ?
        """,
        params + [limit, offset],
    ).fetchall()

    items = [
        CabinetShipmentLineItem(
            doc_id=str(r["doc_id"]),
            doc_number=str(r["doc_number"]),
            cargo_type=str(r["cargo_type"]),
            status=str(r["status"]),
            ship_date=r["ship_date"],
            product_name=str(r["product_name"]),
            product_sku=str(r["product_sku"]),
            color_name=r["color_name"],
            size_name=r["size_name"],
            qty=int(r["qty"] or 0),
            shipped_qty=int(r["shipped_qty"] or 0),
            store_name=r["store_name"],
        )
        for r in rows
    ]
    return CabinetShipmentLinesResponse(items=items, total=total, page=page, limit=limit)


def get_cabinet_shipment(connection, *, client_id: str, doc_id: str) -> CabinetShipmentDetailResponse:
    cond, status_params = _shipment_status_cond(None)
    row = connection.execute(
        f"SELECT * FROM shipment_docs d WHERE d.id = ? AND d.client_id = ? AND d.is_deleted = 0 AND {cond}",
        [doc_id, client_id, *status_params],
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Документ не найден")

    lines_rows = connection.execute(
        "SELECT * FROM shipment_lines WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at, id",
        (doc_id,),
    ).fetchall()
    packed_rows = connection.execute(
        """SELECT shipment_line_id,
              COALESCE(SUM(CASE WHEN to_op='ready'   AND COALESCE(from_op,'')<>'ready' THEN qty
                                WHEN from_op='ready' AND to_op='packing'               THEN -qty ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN to_quality='defect'   AND COALESCE(from_quality,'')<>'defect' THEN qty
                                WHEN from_quality='defect' AND COALESCE(to_quality,'')<>'defect'   THEN -qty ELSE 0 END), 0) AS defect
           FROM zone_relocations
           WHERE shipment_line_id IN (SELECT id FROM shipment_lines WHERE doc_id = ?)
           GROUP BY shipment_line_id""",
        (doc_id,),
    ).fetchall()
    packed_by_line = {str(r["shipment_line_id"]): (int(r["good"] or 0), int(r["defect"] or 0)) for r in packed_rows}

    files_rows = connection.execute(
        "SELECT line_id, filename, url FROM shipment_line_files WHERE doc_id = ? AND is_deleted = 0 ORDER BY created_at",
        (doc_id,),
    ).fetchall()
    files_by_line: dict[str, list[CabinetLineFile]] = {}
    for f in files_rows:
        files_by_line.setdefault(str(f["line_id"]), []).append(
            CabinetLineFile(filename=str(f["filename"]), url=str(f["url"]))
        )

    ops_placeholders = ",".join("?" for _ in CABINET_SHIPMENT_OPS_VISIBLE)
    ops_rows = connection.execute(
        f"""SELECT op_type, comment, created_at
            FROM shipment_ops WHERE doc_id = ? AND op_type IN ({ops_placeholders})
            ORDER BY created_at DESC""",
        [doc_id, *sorted(CABINET_SHIPMENT_OPS_VISIBLE)],
    ).fetchall()

    return CabinetShipmentDetailResponse(
        doc=CabinetShipmentDoc(
            id=str(row["id"]),
            doc_number=str(row["doc_number"]),
            cargo_type=str(row["cargo_type"] or "good"),
            carrier=row["carrier"],
            ship_date=row["ship_date"],
            actual_ship_date=row["actual_ship_date"],
            status=str(row["status"]),
            created_at=str(row["created_at"]),
        ),
        lines=[
            CabinetShipmentLine(
                id=str(l["id"]),
                product_name=str(l["product_name"]),
                product_sku=str(l["product_sku"]),
                color_name=l["color_name"],
                size_name=l["size_name"],
                qty=int(l["qty"] or 0),
                shipped_qty=int(l["shipped_qty"] or 0),
                packed_good=packed_by_line.get(str(l["id"]), (0, 0))[0],
                packed_defect=packed_by_line.get(str(l["id"]), (0, 0))[1],
                store_name=l["store_name"],
                files=files_by_line.get(str(l["id"]), []),
            )
            for l in lines_rows
        ],
        ops=[
            CabinetOpItem(
                op_type=str(o["op_type"]),
                comment=o["comment"],
                created_at=str(o["created_at"]),
            )
            for o in ops_rows
        ],
    )


# ---------------------------------------------------------------------------
# Сводка, отчёты, профиль
# ---------------------------------------------------------------------------

def cabinet_balance_totals(connection, *, client_id: str) -> CabinetBalanceTotals:
    from modules.balances.service import get_balances_summary

    summary = get_balances_summary(connection, client_id=client_id, search=None, has_defect=False)
    return CabinetBalanceTotals(
        storage_good=summary.storage_good,
        packing_good=summary.packing_good,
        ready_good=summary.ready_good,
        total_good=summary.storage_good + summary.packing_good + summary.ready_good,
        defect_total=summary.storage_defect + summary.packing_defect + summary.ready_defect,
    )


def cabinet_summary(connection, *, client_id: str) -> CabinetSummaryResponse:
    active_receipts = list_cabinet_receipts(
        connection,
        client_id=client_id,
        page=1,
        limit=5,
        statuses=[RECEIPT_STATUS_PLANNED, RECEIPT_STATUS_ON_INTAKE],
        order="upcoming",
    ).items
    active_shipments = list_cabinet_shipments(
        connection,
        client_id=client_id,
        page=1,
        limit=5,
        statuses=[
            SHIPMENT_STATUS_PACKING, SHIPMENT_STATUS_ON_PACKING,
            SHIPMENT_STATUS_RELOCATING, SHIPMENT_STATUS_AWAITING_TRIP,
        ],
        order="upcoming",
    ).items

    r_statuses = sorted(CABINET_RECEIPT_VISIBLE_STATUSES)
    s_statuses = sorted(CABINET_SHIPMENT_VISIBLE_STATUSES)
    r_ops = sorted(CABINET_RECEIPT_OPS_VISIBLE)
    s_ops = sorted(CABINET_SHIPMENT_OPS_VISIBLE)
    events_rows = connection.execute(
        f"""
        SELECT 'receipt' AS doc_kind, o.doc_id, d.doc_number, o.op_type, o.qty, o.comment, o.created_at
        FROM receipt_ops o
        JOIN receipt_docs d ON d.id = o.doc_id
        WHERE d.client_id = ? AND d.is_deleted = 0
          AND d.status IN ({",".join("?" for _ in r_statuses)})
          AND o.op_type IN ({",".join("?" for _ in r_ops)})
        UNION ALL
        SELECT 'shipment' AS doc_kind, o.doc_id, d.doc_number, o.op_type, NULL AS qty, o.comment, o.created_at
        FROM shipment_ops o
        JOIN shipment_docs d ON d.id = o.doc_id
        WHERE d.client_id = ? AND d.is_deleted = 0
          AND d.status IN ({",".join("?" for _ in s_statuses)})
          AND o.op_type IN ({",".join("?" for _ in s_ops)})
        ORDER BY created_at DESC
        LIMIT 10
        """,
        [client_id, *r_statuses, *r_ops, client_id, *s_statuses, *s_ops],
    ).fetchall()

    return CabinetSummaryResponse(
        totals=cabinet_balance_totals(connection, client_id=client_id),
        active_receipts=active_receipts,
        active_shipments=active_shipments,
        events=[
            CabinetEventItem(
                doc_kind=str(r["doc_kind"]),
                doc_id=str(r["doc_id"]),
                doc_number=str(r["doc_number"]),
                op_type=str(r["op_type"]),
                qty=int(r["qty"]) if r["qty"] is not None else None,
                comment=r["comment"],
                created_at=str(r["created_at"]),
            )
            for r in events_rows
        ],
    )


def cabinet_packing_report(
    connection,
    *,
    client_id: str,
    date_from: str | None,
    date_to: str | None,
    search: str | None,
) -> CabinetPackingReportResponse:
    from modules.shipments.service import packing_productivity

    raw = packing_productivity(
        connection,
        date_from=date_from,
        date_to=date_to,
        client_id=client_id,
        search=search,
    )
    return CabinetPackingReportResponse(
        days=[
            CabinetPackingReportDay(
                packed_date=str(d["packed_date"]),
                good=int(d["good"]),
                defect=int(d["defect"]),
                total=int(d["total"]),
                sku_count=int(d["sku_count"]),
                doc_count=int(d["doc_count"]),
                rows=[
                    CabinetPackingReportRow(
                        product_sku=r["product_sku"],
                        product_name=r["product_name"],
                        good=int(r["good"]),
                        defect=int(r["defect"]),
                        total=int(r["total"]),
                    )
                    for r in d["rows"]
                ],
            )
            for d in raw["days"]
        ],
        total_good=int(raw["total_good"]),
        total_defect=int(raw["total_defect"]),
        total=int(raw["total"]),
    )


def get_cabinet_profile(connection, *, client_id: str) -> CabinetProfileResponse:
    client_row = connection.execute(
        "SELECT id, name FROM clients WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (client_id,),
    ).fetchone()
    if not client_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Клиент не найден")
    stores_rows = connection.execute(
        """SELECT id, name, is_active FROM client_stores
           WHERE client_id = ? AND COALESCE(is_deleted, 0) = 0
           ORDER BY LOWER(name)""",
        (client_id,),
    ).fetchall()
    return CabinetProfileResponse(
        client={"id": str(client_row["id"]), "name": str(client_row["name"])},
        stores=[
            {"id": str(r["id"]), "name": str(r["name"]), "is_active": bool(r["is_active"])}
            for r in stores_rows
        ],
    )
