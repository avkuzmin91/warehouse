from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from config import CLIENT_LIST_SORT_COLUMNS, COLOR_LIST_SORT_COLUMNS, SIZE_LIST_SORT_COLUMNS
from modules.auth.service import get_current_admin

from .schemas import (
    ClientStoreCreateRequest,
    ClientStoreItem,
    ClientStoreUpdateRequest,
    DictionaryBaseItem,
    DictionaryCreateRequest,
    DictionaryListResponse,
    DictionaryUpdateRequest,
    MessageResponse,
    ProductTypeCreateRequest,
    ProductTypeDictionaryItem,
    ProductTypeListResponse,
    ProductTypeUpdateRequest,
    RecordActualityFilterItem,
    SizeCreateRequest,
    SizeItem,
    SizeListResponse,
    SizeUpdateRequest,
)
from .service import (
    create_dictionary_item,
    create_client_store,
    create_product_type,
    create_size,
    delete_client_store,
    delete_dictionary_item,
    get_dictionary_item,
    get_product_type_item,
    get_size_item,
    list_dictionary_items_page,
    list_client_stores,
    list_product_types_page,
    list_sizes_page,
    set_packing_zone,
    update_dictionary_item,
    update_client_store,
    update_product_type,
    update_size,
    _normalize_date_yyyy_mm_dd,
)
from dbconn import get_connection

router = APIRouter(tags=["dictionaries"])


@router.get("/system/record-actuality", response_model=list[RecordActualityFilterItem])
def list_record_actuality_filter_items(admin=Depends(get_current_admin)):
    _ = admin
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT id, name FROM record_actuality ORDER BY sort_order ASC, LOWER(name) ASC"
        ).fetchall()
    return [RecordActualityFilterItem(id=r["id"], name=r["name"]) for r in rows]


# ── Clients ──────────────────────────────────────────────────────────────────

@router.get("/clients", response_model=DictionaryListResponse)
def list_clients(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_dictionary_items_page(
        "clients", page, limit,
        search=search, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, sort_columns=CLIENT_LIST_SORT_COLUMNS, default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@router.post("/clients", response_model=MessageResponse)
def create_client(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return create_dictionary_item("clients", payload, admin["id"])


@router.get("/clients/{client_id}/stores", response_model=list[ClientStoreItem])
def list_client_store_items(
    client_id: str,
    admin=Depends(get_current_admin),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_client_stores(client_id, include_deleted=include_deleted)


@router.post("/clients/{client_id}/stores", response_model=MessageResponse)
def create_client_store_item(client_id: str, payload: ClientStoreCreateRequest, admin=Depends(get_current_admin)):
    return create_client_store(client_id, payload, admin["id"])


@router.patch("/clients/{client_id}/stores/{store_id}", response_model=MessageResponse)
def update_client_store_item(
    client_id: str,
    store_id: str,
    payload: ClientStoreUpdateRequest,
    admin=Depends(get_current_admin),
):
    return update_client_store(client_id, store_id, payload, admin["id"])


@router.delete("/clients/{client_id}/stores/{store_id}", response_model=MessageResponse)
def delete_client_store_item(client_id: str, store_id: str, admin=Depends(get_current_admin)):
    return delete_client_store(client_id, store_id, admin["id"])


@router.get("/clients/{item_id}", response_model=DictionaryBaseItem)
def get_client(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_dictionary_item("clients", item_id, include_deleted=include_deleted)


@router.patch("/clients/{item_id}", response_model=MessageResponse)
def update_client(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return update_dictionary_item("clients", item_id, payload, admin["id"])


@router.delete("/clients/{item_id}", response_model=MessageResponse)
def delete_client(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("clients", item_id, admin["id"])


# ── Colors ───────────────────────────────────────────────────────────────────

@router.get("/colors", response_model=DictionaryListResponse)
def list_colors(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_dictionary_items_page(
        "colors", page, limit,
        search=name, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, sort_columns=COLOR_LIST_SORT_COLUMNS, default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@router.post("/colors", response_model=MessageResponse)
def create_color(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return create_dictionary_item("colors", payload, admin["id"])


@router.get("/colors/{item_id}", response_model=DictionaryBaseItem)
def get_color(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_dictionary_item("colors", item_id, include_deleted=include_deleted)


@router.patch("/colors/{item_id}", response_model=MessageResponse)
def update_color(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return update_dictionary_item("colors", item_id, payload, admin["id"])


@router.delete("/colors/{item_id}", response_model=MessageResponse)
def delete_color(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("colors", item_id, admin["id"])


# ── Product types ─────────────────────────────────────────────────────────────

@router.get("/product-types", response_model=ProductTypeListResponse)
def list_product_types(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_product_types_page(
        page, limit,
        search=name, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, include_deleted=include_deleted,
    )


@router.post("/product-types", response_model=MessageResponse)
def create_product_type_endpoint(payload: ProductTypeCreateRequest, admin=Depends(get_current_admin)):
    return create_product_type(payload, admin["id"])


@router.get("/product-types/{item_id}", response_model=ProductTypeDictionaryItem)
def get_product_type(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_product_type_item(item_id, include_deleted=include_deleted)


@router.patch("/product-types/{item_id}", response_model=MessageResponse)
def update_product_type_endpoint(item_id: str, payload: ProductTypeUpdateRequest, admin=Depends(get_current_admin)):
    return update_product_type(item_id, payload, admin["id"])


@router.delete("/product-types/{item_id}", response_model=MessageResponse)
def delete_product_type(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("product_types", item_id, admin["id"])


# ── Suppliers ─────────────────────────────────────────────────────────────────

@router.get("/suppliers", response_model=DictionaryListResponse)
def list_suppliers(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_dictionary_items_page(
        "suppliers", page, limit,
        search=name, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, sort_columns=CLIENT_LIST_SORT_COLUMNS, default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@router.post("/suppliers", response_model=MessageResponse)
def create_supplier(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return create_dictionary_item("suppliers", payload, admin["id"])


@router.get("/suppliers/{item_id}", response_model=DictionaryBaseItem)
def get_supplier(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_dictionary_item("suppliers", item_id, include_deleted=include_deleted)


@router.patch("/suppliers/{item_id}", response_model=MessageResponse)
def update_supplier(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return update_dictionary_item("suppliers", item_id, payload, admin["id"])


@router.delete("/suppliers/{item_id}", response_model=MessageResponse)
def delete_supplier(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("suppliers", item_id, admin["id"])


# ── Unloading zones ───────────────────────────────────────────────────────────

@router.get("/unloading-zones", response_model=DictionaryListResponse)
def list_unloading_zones(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_dictionary_items_page(
        "unloading_zones", page, limit,
        search=name, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, sort_columns=CLIENT_LIST_SORT_COLUMNS, default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@router.post("/unloading-zones", response_model=MessageResponse)
def create_unloading_zone(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return create_dictionary_item("unloading_zones", payload, admin["id"])


@router.get("/unloading-zones/{item_id}", response_model=DictionaryBaseItem)
def get_unloading_zone(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_dictionary_item("unloading_zones", item_id, include_deleted=include_deleted)


@router.patch("/unloading-zones/{item_id}", response_model=MessageResponse)
def update_unloading_zone(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return update_dictionary_item("unloading_zones", item_id, payload, admin["id"])


@router.delete("/unloading-zones/{item_id}", response_model=MessageResponse)
def delete_unloading_zone(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("unloading_zones", item_id, admin["id"])


@router.post("/unloading-zones/{item_id}/set-packing", response_model=MessageResponse)
def set_unloading_zone_packing(item_id: str, admin=Depends(get_current_admin)):
    _ = admin
    return set_packing_zone(item_id)


# ── Warehouses ────────────────────────────────────────────────────────────────

@router.get("/warehouses", response_model=DictionaryListResponse)
def list_warehouses(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_dictionary_items_page(
        "warehouses", page, limit,
        search=name, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, sort_columns=CLIENT_LIST_SORT_COLUMNS, default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@router.post("/warehouses", response_model=MessageResponse)
def create_warehouse(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return create_dictionary_item("warehouses", payload, admin["id"])


@router.get("/warehouses/{item_id}", response_model=DictionaryBaseItem)
def get_warehouse(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_dictionary_item("warehouses", item_id, include_deleted=include_deleted)


@router.patch("/warehouses/{item_id}", response_model=MessageResponse)
def update_warehouse(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return update_dictionary_item("warehouses", item_id, payload, admin["id"])


@router.delete("/warehouses/{item_id}", response_model=MessageResponse)
def delete_warehouse(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("warehouses", item_id, admin["id"])


# ── Carriers ──────────────────────────────────────────────────────────────────

@router.get("/carriers", response_model=DictionaryListResponse)
def list_carriers(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_dictionary_items_page(
        "carriers", page, limit,
        search=name, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, sort_columns=CLIENT_LIST_SORT_COLUMNS, default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@router.post("/carriers", response_model=MessageResponse)
def create_carrier(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return create_dictionary_item("carriers", payload, admin["id"])


@router.get("/carriers/{item_id}", response_model=DictionaryBaseItem)
def get_carrier(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_dictionary_item("carriers", item_id, include_deleted=include_deleted)


@router.patch("/carriers/{item_id}", response_model=MessageResponse)
def update_carrier(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return update_dictionary_item("carriers", item_id, payload, admin["id"])


@router.delete("/carriers/{item_id}", response_model=MessageResponse)
def delete_carrier(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("carriers", item_id, admin["id"])


# ── Vehicle types ─────────────────────────────────────────────────────────────

@router.get("/vehicle-types", response_model=DictionaryListResponse)
def list_vehicle_types(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_dictionary_items_page(
        "vehicle_types", page, limit,
        search=name, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, sort_columns=CLIENT_LIST_SORT_COLUMNS, default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@router.post("/vehicle-types", response_model=MessageResponse)
def create_vehicle_type(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return create_dictionary_item("vehicle_types", payload, admin["id"])


@router.get("/vehicle-types/{item_id}", response_model=DictionaryBaseItem)
def get_vehicle_type(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_dictionary_item("vehicle_types", item_id, include_deleted=include_deleted)


@router.patch("/vehicle-types/{item_id}", response_model=MessageResponse)
def update_vehicle_type(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return update_dictionary_item("vehicle_types", item_id, payload, admin["id"])


@router.delete("/vehicle-types/{item_id}", response_model=MessageResponse)
def delete_vehicle_type(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("vehicle_types", item_id, admin["id"])


# ── Defect reasons ────────────────────────────────────────────────────────────

@router.get("/defect-reasons", response_model=DictionaryListResponse)
def list_defect_reasons(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_dictionary_items_page(
        "defect_reasons", page, limit,
        search=name, actuality_id=actuality_id,
        date_from=_normalize_date_yyyy_mm_dd(date_from, "date_from"),
        date_to=_normalize_date_yyyy_mm_dd(date_to, "date_to"),
        sort=sort, sort_columns=CLIENT_LIST_SORT_COLUMNS, default_order="d.created_at DESC",
        include_deleted=include_deleted,
    )


@router.post("/defect-reasons", response_model=MessageResponse)
def create_defect_reason(payload: DictionaryCreateRequest, admin=Depends(get_current_admin)):
    return create_dictionary_item("defect_reasons", payload, admin["id"])


@router.get("/defect-reasons/{item_id}", response_model=DictionaryBaseItem)
def get_defect_reason(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_dictionary_item("defect_reasons", item_id, include_deleted=include_deleted)


@router.patch("/defect-reasons/{item_id}", response_model=MessageResponse)
def update_defect_reason(item_id: str, payload: DictionaryUpdateRequest, admin=Depends(get_current_admin)):
    return update_dictionary_item("defect_reasons", item_id, payload, admin["id"])


@router.delete("/defect-reasons/{item_id}", response_model=MessageResponse)
def delete_defect_reason(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("defect_reasons", item_id, admin["id"])


# ── Sizes ─────────────────────────────────────────────────────────────────────

@router.get("/sizes", response_model=SizeListResponse)
def list_sizes(
    admin=Depends(get_current_admin),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    name: str | None = Query(None),
    actuality_id: str | None = Query(None),
    sort: str | None = Query(None),
    include_deleted: bool = Query(False),
):
    _ = admin
    return list_sizes_page(page, limit, name=name, actuality_id=actuality_id, sort=sort, include_deleted=include_deleted)


@router.post("/sizes", response_model=MessageResponse)
def create_size_endpoint(payload: SizeCreateRequest, admin=Depends(get_current_admin)):
    return create_size(payload, admin["id"])


@router.get("/sizes/{item_id}", response_model=SizeItem)
def get_size(item_id: str, admin=Depends(get_current_admin), include_deleted: bool = Query(False)):
    _ = admin
    return get_size_item(item_id, include_deleted=include_deleted)


@router.patch("/sizes/{item_id}", response_model=MessageResponse)
def update_size_endpoint(item_id: str, payload: SizeUpdateRequest, admin=Depends(get_current_admin)):
    return update_size(item_id, payload, admin["id"])


@router.delete("/sizes/{item_id}", response_model=MessageResponse)
def delete_size(item_id: str, admin=Depends(get_current_admin)):
    return delete_dictionary_item("sizes", item_id, admin["id"])
