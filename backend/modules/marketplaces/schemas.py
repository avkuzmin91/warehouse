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
    is_sandbox: bool = False
    status: str
    last_sync_at: str | None = None
    last_sync_error: str | None = None
    created_at: str


class MpAccountsResponse(BaseModel):
    items: list[MpAccountItem]


class MpAccountCreate(BaseModel):
    client_id: str
    marketplace: str
    name: str
    ozon_client_id: str | None = None
    api_key: str
    is_sandbox: bool = False


class MpAccountUpdate(BaseModel):
    name: str | None = None
    status: str | None = None
    ozon_client_id: str | None = None
    api_key: str | None = None
    is_sandbox: bool | None = None


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
    supply_id: str | None = None
    supply_number: str | None = None
    supply_status: str | None = None
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


# ── FBS-поставки ──────────────────────────────────────────────────────────────

class MpSupplyBoardItem(BaseModel):
    id: str
    doc_number: str
    status: str
    account_id: str
    account_name: str
    marketplace: str
    client_id: str
    client_name: str | None = None
    cutoff_at: str | None = None
    intake_closes_at: str | None = None
    intake_closed_at: str | None = None
    overdue: bool
    orders_total: int
    orders_ready: int
    orders_pending: int
    positions: int
    total_qty: int
    cells_count: int
    unlinked_positions: int
    shortage_positions: int
    no_location_positions: int
    picked_qty: int = 0
    remaining_qty: int = 0
    picker_id: str | None = None
    picker_name: str | None = None
    claimed_at: str | None = None
    created_at: str
    updated_at: str


class MpSupplyBoardCounters(BaseModel):
    supplies: int
    orders: int
    overdue: int


class MpSupplyBoardResponse(BaseModel):
    items: list[MpSupplyBoardItem]
    counters: MpSupplyBoardCounters


class MpSupplyOrderItem(BaseModel):
    order_id: str
    external_id: str
    order_status: str
    state: str
    deadline_at: str | None = None
    created_at_mp: str | None = None
    lines_total: int
    total_qty: int
    summary: str
    cells: list[str]
    blockers: list[str]
    ready: bool = False


class MpSupplyPickItem(BaseModel):
    variant_id: str | None = None
    product_id: str | None = None
    product_sku: str | None = None
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    offer_id: str | None = None
    linked: bool
    need_qty: int
    picked_qty: int = 0
    remaining_qty: int = 0
    available_qty: int
    shortage_qty: int
    orders_count: int
    cells: list[str]


class MpSupplyBlocker(BaseModel):
    kind: str
    text: str
    orders_count: int
    variant_id: str | None = None


class MpSupplyDoc(MpSupplyBoardItem):
    created_by_name: str | None = None
    external_supply_id: str | None = None
    checking_at: str | None = None
    picking_at: str | None = None
    handover_at: str | None = None
    done_at: str | None = None


class MpSupplyDetailResponse(BaseModel):
    doc: MpSupplyDoc
    orders: list[MpSupplyOrderItem]
    pick_list: list[MpSupplyPickItem]
    blockers: list[MpSupplyBlocker]


class MpSupplyOpItem(BaseModel):
    id: str
    op_type: str
    comment: str | None = None
    created_at: str
    created_by_name: str | None = None


class MpSupplyOpsResponse(BaseModel):
    items: list[MpSupplyOpItem]


class MpSupplyCandidateItem(BaseModel):
    order_id: str
    external_id: str
    order_status: str
    deadline_at: str | None = None
    created_at_mp: str | None = None
    total_qty: int


class MpSupplyCandidatesResponse(BaseModel):
    items: list[MpSupplyCandidateItem]


class MpSupplyPickCell(BaseModel):
    """Место хранения позиции для ТСД: id нужен, чтобы сверить скан места."""
    zone_id: str | None = None
    zone_name: str | None = None
    qty: int
    container_id: str | None = None
    container_number: str | None = None


class MpSupplyPickRow(MpSupplyPickItem):
    """Строка листа подбора на ТСД: та же позиция плюс адреса под скан."""
    locations: list[MpSupplyPickCell] = Field(default_factory=list)


class MpSupplyPickViewResponse(BaseModel):
    id: str
    doc_number: str
    status: str
    account_name: str
    client_name: str | None = None
    cutoff_at: str | None = None
    overdue: bool
    orders_total: int
    need_qty: int
    picked_qty: int
    remaining_qty: int
    picker_id: str | None = None
    picker_name: str | None = None
    can_finish: bool
    blockers: list[str] = Field(default_factory=list)
    items: list[MpSupplyPickRow] = Field(default_factory=list)


class MpSupplyQueueResponse(BaseModel):
    queue: int
    supply_id: str | None = None


class MpPickScanRequest(BaseModel):
    barcode: str
    zone_id: str
    container_id: str | None = None
    qty: int = Field(default=1, ge=1)


class MpPickScanResult(BaseModel):
    pick_id: str
    variant_id: str
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    need_qty: int
    picked_qty: int
    remaining_qty: int


class MpSupplyOrdersRequest(BaseModel):
    order_ids: list[str] = Field(default_factory=list)
