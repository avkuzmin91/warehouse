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
    supply_state: str | None = None
    first_seen_at: str
    updated_at: str
    packed_at: str | None = None
    mp_shipped_at: str | None = None
    mp_error: str | None = None
    label_url: str | None = None
    label_barcode: str | None = None
    # Где заказ в нашем процессе и что мешает его собрать — считается на список.
    stage: str = ""
    summary: str = ""
    cells: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    unlinked_offers: list[str] = Field(default_factory=list)
    shortage_qty: int = 0


class MpOrdersResponse(BaseModel):
    items: list[MpOrderListItem]
    total: int
    page: int
    limit: int


class MpOrdersSummaryResponse(BaseModel):
    by_status: dict[str, int]
    overdue_count: int
    no_supply_count: int = 0
    error_count: int = 0
    unlinked_orders_count: int = 0
    unlinked_offers: list[str] = Field(default_factory=list)
    last_sync_at: str | None = None
    last_sync_ok: bool | None = None
    last_sync_error: str | None = None


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
    external_color: str | None = None
    account_id: str
    account_name: str
    marketplace: str
    client_id: str
    client_name: str | None = None
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


class MpProductArticleItem(BaseModel):
    mp_product_id: str
    marketplace: str
    account_name: str
    offer_id: str | None = None
    title: str | None = None
    external_id: str
    external_size: str | None = None
    external_color: str | None = None
    variant_id: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    link_source: str
    linked_at: str
    linked_by: str | None = None


class MpProductArticlesResponse(BaseModel):
    items: list[MpProductArticleItem] = Field(default_factory=list)


class MpProductsResponse(BaseModel):
    items: list[MpProductItem]
    total: int
    page: int
    limit: int


class MpLinkRequest(BaseModel):
    product_id: str = Field(min_length=1)
    variant_id: str | None = None


class MpLinkResponse(BaseModel):
    message: str
    barcodes_written: int = 0
    barcodes_skipped: int = 0


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
    orders_packed: int = 0
    orders_labeled: int = 0
    orders_cancelled: int = 0
    orders_cancelled_held: int = 0
    picker_id: str | None = None
    picker_name: str | None = None
    claimed_at: str | None = None
    created_at: str
    updated_at: str


class MpSupplyBoardCounters(BaseModel):
    supplies: int
    orders: int
    overdue: int
    free_orders: int = 0


class MpFreePoolItem(BaseModel):
    """Свободные заказы кабинета: очередь, из которой набирают поставки."""
    account_id: str
    account_name: str
    marketplace: str
    client_id: str
    client_name: str | None = None
    earliest_deadline_at: str | None = None
    orders_count: int
    total_qty: int
    overdue_count: int = 0
    urgent_count: int = 0


class MpSupplyBoardResponse(BaseModel):
    items: list[MpSupplyBoardItem]
    free_pool: list[MpFreePoolItem] = Field(default_factory=list)
    counters: MpSupplyBoardCounters


class MpSupplyCreateRequest(BaseModel):
    account_id: str
    order_ids: list[str] = Field(default_factory=list)


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
    unlinked_offers: list[str] = []
    ready: bool = False
    packed_at: str | None = None
    mp_shipped_at: str | None = None
    mp_error: str | None = None
    label_url: str | None = None
    label_barcode: str | None = None
    cargo_unit_id: str | None = None
    cargo_unit_number: str | None = None


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
    mp_transferred_at: str | None = None
    checking_at: str | None = None
    correcting_at: str | None = None
    picking_at: str | None = None
    packing_at: str | None = None
    handover_at: str | None = None
    done_at: str | None = None
    cargo_units_total: int = 0
    cargo_units_open: int = 0
    return_debt_qty: int = 0


class MpCargoOrder(BaseModel):
    order_id: str
    external_id: str
    label_barcode: str | None = None
    total_qty: int
    added_at: str | None = None


class MpCargoUnit(BaseModel):
    id: str
    supply_id: str
    supply_number: str
    supply_status: str
    doc_number: str
    kind: str
    kind_label: str
    status: str
    external_id: str | None = None
    closed_at: str | None = None
    created_at: str
    orders_count: int
    items_qty: int
    orders: list[MpCargoOrder] = Field(default_factory=list)


class MpCargoUnitsResponse(BaseModel):
    items: list[MpCargoUnit]


class MpCargoCreateRequest(BaseModel):
    kind: str = "box"


class MpCargoLookupResponse(BaseModel):
    found: bool
    unit: MpCargoUnit | None = None


class MpCargoLabel(BaseModel):
    id: str
    doc_number: str
    kind_label: str
    supply_number: str
    orders_count: int
    payload: str
    qr_svg: str


class MpCargoLabelsResponse(BaseModel):
    items: list[MpCargoLabel]


class MpCargoOrderScanRequest(BaseModel):
    code: str


class MpCargoOrderScanResult(BaseModel):
    order_id: str
    external_id: str
    already: bool
    orders_count: int


class MpSupplyDetailResponse(BaseModel):
    doc: MpSupplyDoc
    orders: list[MpSupplyOrderItem]
    pick_list: list[MpSupplyPickItem]
    blockers: list[MpSupplyBlocker]
    cargo_units: list[MpCargoUnit] = Field(default_factory=list)


class MpSupplyOpItem(BaseModel):
    id: str
    op_type: str
    comment: str | None = None
    created_at: str
    created_by_name: str | None = None


class MpSupplyOpsResponse(BaseModel):
    items: list[MpSupplyOpItem]


class MpSupplyCandidatesResponse(BaseModel):
    """Свободный пул кабинета: заказы в той же форме, что и состав поставки."""
    items: list[MpSupplyOrderItem]


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


class MpReturnItem(BaseModel):
    """Позиция долга возврата: собрано под заказ, которого в составе больше нет."""
    variant_id: str
    product_name: str | None = None
    product_sku: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    qty: int


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
    return_debt_qty: int = 0
    return_items: list[MpReturnItem] = Field(default_factory=list)
    orders_cancelled: int = 0


class MpSupplyQueueResponse(BaseModel):
    queue: int
    supply_id: str | None = None
    supply_status: str | None = None


class MpPickScanRequest(BaseModel):
    barcode: str
    zone_id: str
    container_id: str | None = None
    qty: int = Field(default=1, ge=1)


class MpPickReturnRequest(BaseModel):
    barcode: str
    zone_id: str
    qty: int = Field(default=1, ge=1)


class MpPickReturnResult(BaseModel):
    variant_id: str
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    returned_qty: int
    debt_qty: int
    debt_total_qty: int


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


# ── Станция упаковки ──────────────────────────────────────────────────────────

class MpPackLine(BaseModel):
    line_id: str
    variant_id: str | None = None
    product_name: str | None = None
    product_sku: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    offer_id: str | None = None
    linked: bool
    need_qty: int
    packed_qty: int


class MpPackOrder(BaseModel):
    order_id: str
    external_id: str
    order_status: str
    deadline_at: str | None = None
    packed_at: str | None = None
    mp_shipped_at: str | None = None
    mp_error: str | None = None
    label_url: str | None = None
    label_barcode: str | None = None
    cargo_unit_id: str | None = None
    cargo_unit_number: str | None = None
    need_qty: int
    packed_qty: int
    complete: bool
    lines: list[MpPackLine] = Field(default_factory=list)


class MpPackTableRow(BaseModel):
    """Стол упаковки: собрано по варианту, уложено в заказы, осталось на столе."""
    variant_id: str
    product_name: str | None = None
    product_sku: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    need_qty: int
    picked_qty: int
    packed_qty: int
    on_table_qty: int


class MpSupplyPackViewResponse(BaseModel):
    id: str
    doc_number: str
    status: str
    marketplace: str
    account_name: str
    client_name: str | None = None
    external_supply_id: str | None = None
    cutoff_at: str | None = None
    overdue: bool
    picker_id: str | None = None
    picker_name: str | None = None
    orders_total: int
    orders_packed: int
    orders_labeled: int
    need_qty: int
    packed_qty: int
    can_finish: bool
    blockers: list[str] = Field(default_factory=list)
    orders: list[MpPackOrder] = Field(default_factory=list)
    table: list[MpPackTableRow] = Field(default_factory=list)
    return_debt_qty: int = 0
    return_items: list[MpReturnItem] = Field(default_factory=list)
    orders_cancelled: int = 0


class MpPackScanRequest(BaseModel):
    code: str
    qty: int = Field(default=1, ge=1)


class MpPackScanResult(BaseModel):
    pack_id: str
    order_id: str
    line_id: str
    variant_id: str
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    need_qty: int
    packed_qty: int
    order_complete: bool
    cis_serial: str | None = None


class MpOrderPushResult(BaseModel):
    ok: bool
    error: str | None = None
    order_id: str
    label_url: str | None = None
    label_barcode: str | None = None


class MpSupplyLabelsResult(BaseModel):
    ok: bool
    error: str | None = None
    fetched: int
    labeled: int
    total: int
