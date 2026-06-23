from __future__ import annotations

from typing import Any, Mapping

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from dbconn import get_connection
from modules.auth.service import get_current_manager, get_current_shipment_viewer
from modules.dictionaries.schemas import ClientStoreItem, DictionaryBaseItem


router = APIRouter(prefix="/inventory", tags=["inventory"])

_get_lookup_viewer = get_current_shipment_viewer


class InventoryProductTypeLookup(BaseModel):
    id: str
    name: str
    requires_color: bool
    requires_size: bool


class InventoryProductLookup(BaseModel):
    id: str
    name: str
    sku: str
    sku_pending: bool = False
    type_id: str
    type_name: str
    supplier_id: str | None = None
    supplier_name: str | None = None
    requires_color: bool
    requires_size: bool


class ProductVariantPair(BaseModel):
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None


def _dict_item(row: Mapping[str, Any]) -> DictionaryBaseItem:
    return DictionaryBaseItem(
        id=str(row["id"]),
        name=str(row["name"]),
        is_active=bool(row["is_active"]),
        is_deleted=bool(row["is_deleted"]),
        deleted_at=row["deleted_at"],
        deleted_by=row["deleted_by"],
        created_at=str(row["created_at"]),
        created_by=row["created_by"],
        updated_at=row["updated_at"],
        updated_by=row["updated_by"],
    )


def _active_dictionary_rows(table_name: str) -> list[DictionaryBaseItem]:
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT d.id, d.name, d.is_active, COALESCE(d.is_deleted, 0) AS is_deleted,
                   d.deleted_at, deleter.email AS deleted_by,
                   d.created_at, creator.email AS created_by,
                   d.updated_at, editor.email AS updated_by
            FROM {table_name} d
            LEFT JOIN users creator ON creator.id = d.creator_id
            LEFT JOIN users editor ON editor.id = d.updated_by_id
            LEFT JOIN users deleter ON deleter.id = d.deleted_by_id
            WHERE d.is_active = 1 AND COALESCE(d.is_deleted, 0) = 0
            ORDER BY LOWER(d.name) ASC
            """
        ).fetchall()
    return [_dict_item(row) for row in rows]


@router.get("/lookups/clients", response_model=list[DictionaryBaseItem])
def lookup_clients(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("clients")


@router.get("/lookups/client-stores", response_model=list[ClientStoreItem])
def lookup_client_stores(client_id: str | None = Query(None), user=Depends(_get_lookup_viewer)):
    _ = user
    if not client_id or not client_id.strip():
        return []
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT s.id, s.client_id, s.name, s.is_active, COALESCE(s.is_deleted, 0) AS is_deleted,
                   s.deleted_at, s.created_at, s.updated_at,
                   creator.email AS created_by, editor.email AS updated_by, deleter.email AS deleted_by
            FROM client_stores s
            LEFT JOIN users creator ON creator.id = s.creator_id
            LEFT JOIN users editor ON editor.id = s.updated_by_id
            LEFT JOIN users deleter ON deleter.id = s.deleted_by_id
            WHERE s.client_id = ?
              AND s.is_active = 1
              AND COALESCE(s.is_deleted, 0) = 0
            ORDER BY LOWER(s.name) ASC
            """,
            (client_id.strip(),),
        ).fetchall()
    return [
        ClientStoreItem(
            id=str(row["id"]),
            client_id=str(row["client_id"]),
            name=str(row["name"]),
            is_active=bool(row["is_active"]),
            is_deleted=bool(row["is_deleted"]),
            deleted_at=row["deleted_at"],
            deleted_by=row["deleted_by"],
            created_at=str(row["created_at"]),
            created_by=row["created_by"],
            updated_at=row["updated_at"],
            updated_by=row["updated_by"],
        )
        for row in rows
    ]


@router.get("/lookups/colors", response_model=list[DictionaryBaseItem])
def lookup_colors(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("colors")


@router.get("/lookups/sizes", response_model=list[DictionaryBaseItem])
def lookup_sizes(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("sizes")


@router.get("/lookups/suppliers", response_model=list[DictionaryBaseItem])
def lookup_suppliers(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("suppliers")


@router.get("/lookups/warehouses", response_model=list[DictionaryBaseItem])
def lookup_warehouses(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("warehouses")


@router.get("/lookups/shipment-destinations", response_model=list[DictionaryBaseItem])
def lookup_shipment_destinations(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("warehouses")


@router.get("/lookups/carriers", response_model=list[DictionaryBaseItem])
def lookup_carriers(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("carriers")


@router.get("/lookups/vehicle-types", response_model=list[DictionaryBaseItem])
def lookup_vehicle_types(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("vehicle_types")


@router.get("/lookups/positions", response_model=list[DictionaryBaseItem])
def lookup_positions(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("positions")


@router.get("/lookups/unloading-zones", response_model=list[DictionaryBaseItem])
def lookup_unloading_zones(user=Depends(_get_lookup_viewer)):
    _ = user
    return _active_dictionary_rows("unloading_zones")


@router.get("/lookups/product-types", response_model=list[InventoryProductTypeLookup])
def lookup_product_types(user=Depends(get_current_manager)):
    _ = user
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, name, COALESCE(requires_color, 0) AS requires_color,
                   COALESCE(requires_size, 0) AS requires_size
            FROM product_types
            WHERE is_active = 1 AND COALESCE(is_deleted, 0) = 0
            ORDER BY LOWER(name) ASC
            """
        ).fetchall()
    return [
        InventoryProductTypeLookup(
            id=str(row["id"]),
            name=str(row["name"]),
            requires_color=bool(row["requires_color"]),
            requires_size=bool(row["requires_size"]),
        )
        for row in rows
    ]


@router.get("/lookups/products", response_model=list[InventoryProductLookup])
def lookup_products(
    client_id: str | None = Query(None),
    user=Depends(get_current_manager),
):
    _ = user
    conds = ["p.is_active = 1", "COALESCE(p.is_deleted, 0) = 0"]
    params: list[object] = []
    if client_id and client_id.strip():
        conds.append("p.client_id = ?")
        params.append(client_id.strip())
    where_sql = " AND ".join(conds)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT p.id, p.name, p.sku, COALESCE(p.sku_pending, 0) AS sku_pending,
                   p.type_id, pt.name AS type_name,
                   p.supplier_id, s.name AS supplier_name,
                   COALESCE(pt.requires_color, 0) AS requires_color,
                   COALESCE(pt.requires_size, 0) AS requires_size
            FROM products p
            JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN suppliers s ON s.id = p.supplier_id
            WHERE {where_sql}
              AND pt.is_active = 1
              AND COALESCE(pt.is_deleted, 0) = 0
            ORDER BY LOWER(p.name) ASC, LOWER(p.sku) ASC
            """,
            params,
        ).fetchall()
    return [
        InventoryProductLookup(
            id=str(row["id"]),
            name=str(row["name"]),
            sku=str(row["sku"]),
            sku_pending=bool(row["sku_pending"]),
            type_id=str(row["type_id"]),
            type_name=str(row["type_name"]),
            supplier_id=str(row["supplier_id"]) if row["supplier_id"] else None,
            supplier_name=str(row["supplier_name"]) if row["supplier_name"] else None,
            requires_color=bool(row["requires_color"]),
            requires_size=bool(row["requires_size"]),
        )
        for row in rows
    ]


@router.get("/lookups/skus", response_model=list[str])
def lookup_skus(user=Depends(get_current_manager)):
    _ = user
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT sku
            FROM products
            WHERE is_active = 1 AND COALESCE(is_deleted, 0) = 0
            ORDER BY LOWER(sku) ASC
            """
        ).fetchall()
    return [str(row["sku"]) for row in rows]


@router.get("/lookups/colors-for-sku", response_model=list[DictionaryBaseItem])
def lookup_colors_for_sku(
    sku: str = Query(""),
    product_id: str = Query(""),
    user=Depends(get_current_manager),
):
    _ = user
    sku_t = sku.strip()
    pid_t = product_id.strip()
    # Товары «ожидают SKU» имеют пустой SKU, поэтому ключом служит product_id, если он задан.
    if not pid_t and not sku_t:
        return []
    if pid_t:
        match_sql = "v.product_id = ?"
        match_params: tuple = (pid_t,)
    else:
        match_sql = "(LOWER(TRIM(p.sku)) = LOWER(?) OR LOWER(TRIM(v.sku)) = LOWER(?))"
        match_params = (sku_t, sku_t)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT DISTINCT c.id, c.name, c.is_active, COALESCE(c.is_deleted, 0) AS is_deleted,
                   c.deleted_at, deleter.email AS deleted_by,
                   c.created_at, creator.email AS created_by,
                   c.updated_at, editor.email AS updated_by
            FROM product_variants v
            JOIN products p ON p.id = v.product_id
            JOIN colors c ON c.id = v.color_id
            LEFT JOIN users creator ON creator.id = c.creator_id
            LEFT JOIN users editor ON editor.id = c.updated_by_id
            LEFT JOIN users deleter ON deleter.id = c.deleted_by_id
            WHERE {match_sql}
              AND p.is_active = 1 AND COALESCE(p.is_deleted, 0) = 0
              AND v.is_active = 1 AND COALESCE(v.is_deleted, 0) = 0
              AND c.is_active = 1 AND COALESCE(c.is_deleted, 0) = 0
            ORDER BY c.name ASC
            """,
            match_params,
        ).fetchall()
    return [_dict_item(row) for row in rows]


@router.get("/lookups/sizes-for-sku", response_model=list[DictionaryBaseItem])
def lookup_sizes_for_sku(
    sku: str = Query(""),
    product_id: str = Query(""),
    color_id: str = Query(""),
    user=Depends(get_current_manager),
):
    _ = user
    sku_t = sku.strip()
    pid_t = product_id.strip()
    color_t = color_id.strip()
    if not color_t or (not pid_t and not sku_t):
        return []
    if pid_t:
        match_sql = "v.product_id = ?"
        match_params: tuple = (pid_t,)
    else:
        match_sql = "(LOWER(TRIM(p.sku)) = LOWER(?) OR LOWER(TRIM(v.sku)) = LOWER(?))"
        match_params = (sku_t, sku_t)
    with get_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT DISTINCT sz.id, sz.name, sz.is_active, COALESCE(sz.is_deleted, 0) AS is_deleted,
                   sz.deleted_at, deleter.email AS deleted_by,
                   sz.created_at, creator.email AS created_by,
                   sz.updated_at, editor.email AS updated_by
            FROM product_variants v
            JOIN products p ON p.id = v.product_id
            JOIN sizes sz ON sz.id = v.size_id
            LEFT JOIN users creator ON creator.id = sz.creator_id
            LEFT JOIN users editor ON editor.id = sz.updated_by_id
            LEFT JOIN users deleter ON deleter.id = sz.deleted_by_id
            WHERE {match_sql}
              AND v.color_id = ?
              AND p.is_active = 1 AND COALESCE(p.is_deleted, 0) = 0
              AND v.is_active = 1 AND COALESCE(v.is_deleted, 0) = 0
              AND sz.is_active = 1 AND COALESCE(sz.is_deleted, 0) = 0
            ORDER BY sz.name ASC
            """,
            (*match_params, color_t),
        ).fetchall()
    return [_dict_item(row) for row in rows]


@router.get("/lookups/variants", response_model=list[ProductVariantPair])
def lookup_variants(
    product_id: str = Query(""),
    user=Depends(get_current_manager),
):
    """Полная матрица складских вариантов товара (цвет × размер) одним запросом —
    источник сетки для массового ввода. Возвращает реально существующие пары
    (с учётом товаров без цвета/размера: соответствующие поля null)."""
    _ = user
    pid_t = product_id.strip()
    if not pid_t:
        return []
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT
                   v.color_id, c.name AS color_name,
                   v.size_id,  sz.name AS size_name
            FROM product_variants v
            LEFT JOIN colors c ON c.id = v.color_id
                 AND c.is_active = 1 AND COALESCE(c.is_deleted, 0) = 0
            LEFT JOIN sizes sz ON sz.id = v.size_id
                 AND sz.is_active = 1 AND COALESCE(sz.is_deleted, 0) = 0
            WHERE v.product_id = ?
              AND v.is_active = 1 AND COALESCE(v.is_deleted, 0) = 0
              AND (v.color_id IS NULL OR c.id IS NOT NULL)
              AND (v.size_id IS NULL OR sz.id IS NOT NULL)
            ORDER BY c.name ASC, sz.name ASC
            """,
            (pid_t,),
        ).fetchall()
    return [
        ProductVariantPair(
            color_id=str(row["color_id"]) if row["color_id"] else None,
            color_name=str(row["color_name"]) if row["color_name"] else None,
            size_id=str(row["size_id"]) if row["size_id"] else None,
            size_name=str(row["size_name"]) if row["size_name"] else None,
        )
        for row in rows
    ]
