from __future__ import annotations

from fastapi import HTTPException, status

from config import (
    PRODUCT_LIST_SORT_COLUMNS,
    SHIPMENT_CARGO_DEFECT,
    SHIPMENT_CARGO_GOOD,
    SHIPMENT_STATUS_SHIPPED,
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
               GREATEST(0, COALESCE(b.good_in, 0) - COALESCE(sg.shipped_good, 0)) AS stock,
               GREATEST(0, COALESCE(b.defect_in, 0) - COALESCE(sd.shipped_defect, 0)) AS defect_qty,
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
                   SUM(CASE WHEN to_status='good'   THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_status='good'   THEN qty ELSE 0 END) AS good_in,
                   SUM(CASE WHEN to_status='defect' THEN qty ELSE 0 END)
                     - SUM(CASE WHEN from_status='defect' THEN qty ELSE 0 END) AS defect_in
            FROM zone_relocations
            WHERE product_id = ? AND client_id = ?
            GROUP BY product_id, color_id, size_id
        ) b ON b.product_id = v.product_id AND b.color_id IS NOT DISTINCT FROM v.color_id AND b.size_id IS NOT DISTINCT FROM v.size_id
        LEFT JOIN (
            SELECT sl.product_id, sl.color_id, sl.size_id, SUM(COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)) AS shipped_good
            FROM shipment_lines sl JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.product_id = ? AND sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.client_id = ? AND sd.status = ? AND sd.cargo_type = ?
            GROUP BY sl.product_id, sl.color_id, sl.size_id
        ) sg ON sg.product_id = v.product_id AND sg.color_id IS NOT DISTINCT FROM v.color_id AND sg.size_id IS NOT DISTINCT FROM v.size_id
        LEFT JOIN (
            SELECT sl.product_id, sl.color_id, sl.size_id, SUM(COALESCE(NULLIF(sl.shipped_qty, 0), sl.qty)) AS shipped_defect
            FROM shipment_lines sl JOIN shipment_docs sd ON sd.id = sl.doc_id
            WHERE sl.product_id = ? AND sl.is_deleted = 0 AND sd.is_deleted = 0 AND sd.client_id = ? AND sd.status = ? AND sd.cargo_type = ?
            GROUP BY sl.product_id, sl.color_id, sl.size_id
        ) sd ON sd.product_id = v.product_id AND sd.color_id IS NOT DISTINCT FROM v.color_id AND sd.size_id IS NOT DISTINCT FROM v.size_id
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
            SHIPMENT_STATUS_SHIPPED,
            SHIPMENT_CARGO_GOOD,
            product_id,
            client_id,
            SHIPMENT_STATUS_SHIPPED,
            SHIPMENT_CARGO_DEFECT,
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
