from __future__ import annotations

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


# ── Подключения кабинетов ─────────────────────────────────────────────────────

class MpAccountItem(BaseModel):
    id: str
    client_id: str
    client_name: str | None = None
    marketplace: str
    name: str
    ozon_client_id_masked: str | None = None
    api_key_masked: str
    status: str
    last_sync_at: str | None = None
    last_sync_error: str | None = None
    stock_sync_enabled: bool = False
    stock_warehouse_id: str | None = None
    stock_warehouse_name: str | None = None
    last_stock_push_at: str | None = None
    last_stock_push_error: str | None = None
    created_at: str


class MpAccountsResponse(BaseModel):
    items: list[MpAccountItem]


class MpAccountCreate(BaseModel):
    client_id: str
    marketplace: str
    name: str
    ozon_client_id: str | None = None
    api_key: str


class MpAccountUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    ozon_client_id: str | None = None
    api_key: str | None = None
    stock_warehouse_id: str | None = None
    stock_sync_enabled: bool | None = None


class SyncStatsResponse(BaseModel):
    message: str
    stats: dict


# ── Заказы ────────────────────────────────────────────────────────────────────

class MpOrderListItem(BaseModel):
    id: str
    account_id: str
    account_name: str
    marketplace: str
    client_id: str
    client_name: str | None = None
    external_id: str
    status: str
    external_status: str
    created_at_mp: str | None = None
    deadline_at: str | None = None
    deadline_source: str | None = None
    total_qty: int
    lines_total: int
    lines_linked: int
    first_seen_at: str
    updated_at: str


class MpOrdersResponse(BaseModel):
    items: list[MpOrderListItem]
    total: int
    page: int
    limit: int


class MpOrdersSummaryResponse(BaseModel):
    by_status: dict[str, int]
    overdue_count: int


class MpOrderLine(BaseModel):
    id: str
    offer_id: str | None = None
    title: str | None = None
    qty: int
    price_kopecks: int | None = None
    mp_product_id: str | None = None
    mp_external_id: str | None = None
    external_size: str | None = None
    linked: bool
    product_id: str | None = None
    variant_id: str | None = None
    product_sku: str | None = None
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None


class MpOrderDetailResponse(BaseModel):
    doc: MpOrderListItem
    lines: list[MpOrderLine]


# ── Карточки МП и связка ──────────────────────────────────────────────────────

class MpProductSuggestion(BaseModel):
    product_id: str
    variant_id: str
    product_sku: str | None = None
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None


class MpProductItem(BaseModel):
    id: str
    external_id: str
    external_size: str | None = None
    offer_id: str | None = None
    title: str | None = None
    barcodes: list[str]
    linked: bool
    link_source: str | None = None
    product_id: str | None = None
    variant_id: str | None = None
    product_sku: str | None = None
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    barcode_conflict: bool
    suggestion: MpProductSuggestion | None = None


class MpProductsResponse(BaseModel):
    items: list[MpProductItem]
    total: int
    page: int
    limit: int


class MpLinkRequest(BaseModel):
    product_id: str = Field(min_length=1)
    variant_id: str | None = None


# ── Остатки: склады МП и сверка ───────────────────────────────────────────────

class MpWarehouseItem(BaseModel):
    external_id: str
    name: str | None = None
    office_id: str | None = None
    cargo_type: str | None = None
    delivery_type: str | None = None
    updated_at: str


class MpWarehousesResponse(BaseModel):
    items: list[MpWarehouseItem]


class MpStockRow(BaseModel):
    mp_product_id: str
    external_id: str
    external_size: str | None = None
    offer_id: str | None = None
    title: str | None = None
    barcodes: list[str]
    product_id: str | None = None
    variant_id: str | None = None
    product_sku: str | None = None
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    qty: int | None = None
    pushed_qty: int | None = None
    mp_qty: int | None = None
    diff: int | None = None
    skip_reason: str | None = None
    note: str | None = None


class MpStockReportResponse(BaseModel):
    items: list[MpStockRow]
    total: int
    marketplace_error: str | None = None
    checked_at: str
