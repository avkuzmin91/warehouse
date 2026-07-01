from __future__ import annotations

from pydantic import BaseModel, Field


class ReceiptDocCreate(BaseModel):
    client_id: str
    supplier_name: str | None = None
    arrival_date: str | None = None
    comment: str | None = None
    zone_id: str | None = None
    zone_name: str | None = None
    ttn: str | None = None
    logistics_cost: float | None = None
    lines: list["ReceiptLineCreate"] = []


class ReceiptLineCreate(BaseModel):
    product_id: str
    product_name: str
    product_sku: str
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    planned_qty: int = Field(ge=1)


class ReceiptDocUpdate(BaseModel):
    client_id: str | None = None
    supplier_name: str | None = None
    arrival_date: str | None = None
    comment: str | None = None
    zone_id: str | None = None
    zone_name: str | None = None
    ttn: str | None = None
    logistics_cost: float | None = None


class ReceiptLineAdd(BaseModel):
    product_id: str
    product_name: str
    product_sku: str
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    planned_qty: int = Field(ge=1)


class ReceiptLineUpdate(BaseModel):
    planned_qty: int | None = Field(default=None, ge=1)
    accepted_qty: int | None = Field(default=None, ge=0)
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None


class ReceiptActualArrivalUpdate(BaseModel):
    actual_arrival_date: str | None = None


class ReceiptReceivedCorrection(BaseModel):
    """Пост-фактум корректировка обсчёта приёмки по строке: новое принятое + причина."""
    accepted_qty: int = Field(ge=0)
    reason: str


class ReceiptArriveLine(BaseModel):
    line_id: str
    accepted_qty: int = Field(ge=0)


class ReceiptArrivePayload(BaseModel):
    lines: list[ReceiptArriveLine] = []


class ReceiptOpRecord(BaseModel):
    line_id: str
    op_type: str  # receiving | defect_fix | receiving_correction | defect_correction
    qty: int = Field(ge=0)
    reason: str | None = None
    comment: str | None = None


class ReceiptLineQcComplete(BaseModel):
    accepted: int | None = None
    defect: int | None = None


class TripRef(BaseModel):
    id: str
    number: str


class ReceiptDocResponse(BaseModel):
    id: str
    doc_number: str
    client_id: str
    client_name: str | None = None
    supplier_name: str | None = None
    arrival_date: str | None = None
    actual_arrival_date: str | None = None
    comment: str | None = None
    status: str
    zone_id: str | None = None
    zone_name: str | None = None
    ttn: str | None = None
    logistics_cost: float | None = None
    trip_id: str | None = None
    trip_number: str | None = None
    trips: list[TripRef] = []
    created_at: str
    created_by: str | None = None
    updated_at: str | None = None


class ReceiptLinePlacement(BaseModel):
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    qty: int


class ReceiptLineResponse(BaseModel):
    id: str
    doc_id: str
    product_id: str
    product_name: str
    product_sku: str
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    planned_qty: int
    accepted_qty: int | None = None
    arrived_qty: int = 0
    # Фактическая раскладка принятого по ячейкам (из журнала). Пусто, пока не принято.
    placements: list[ReceiptLinePlacement] = Field(default_factory=list)
    created_at: str


class ReceiptOpResponse(BaseModel):
    id: str
    doc_id: str
    line_id: str | None = None
    op_type: str
    qty: int | None = None
    reason: str | None = None
    comment: str | None = None
    created_at: str
    created_by: str | None = None
    created_by_email: str | None = None


class ReceiptDetailResponse(BaseModel):
    doc: ReceiptDocResponse
    lines: list[ReceiptLineResponse]
    ops: list[ReceiptOpResponse]
    state: dict
    can_close_short: bool = False


class ReceiptListItem(BaseModel):
    id: str
    doc_number: str
    client_id: str
    client_name: str | None = None
    supplier_name: str | None = None
    arrival_date: str | None = None
    actual_arrival_date: str | None = None
    comment: str | None = None
    status: str
    zone_id: str | None = None
    zone_name: str | None = None
    ttn: str | None = None
    logistics_cost: float | None = None
    trip_id: str | None = None
    trip_number: str | None = None
    trips: list[TripRef] = []
    created_at: str
    created_by: str | None = None
    sku_count: int = 0
    total_planned: int = 0
    total_accepted_qty: int = 0


class ReceiptListResponse(BaseModel):
    items: list[ReceiptListItem]
    total: int
    page: int
    limit: int


class ReceiptLinesListItem(BaseModel):
    line_id: str
    doc_id: str
    doc_number: str
    client_id: str
    client_name: str | None = None
    arrival_date: str | None = None
    actual_arrival_date: str | None = None
    status: str
    product_id: str
    product_name: str
    product_sku: str
    color_name: str | None = None
    size_name: str | None = None
    planned_qty: int
    accepted_qty: int | None = None
    storage_zone_name: str | None = None


class ReceiptLinesResponse(BaseModel):
    items: list[ReceiptLinesListItem]
    total: int
    page: int
    limit: int


class ReceiptDuplicateCheckLine(BaseModel):
    product_id: str
    color_id: str | None = None
    size_id: str | None = None
    planned_qty: int = Field(ge=1)


class ReceiptDuplicateCheck(BaseModel):
    client_id: str
    arrival_date: str | None = None
    lines: list[ReceiptDuplicateCheckLine] = []


class DuplicateMatchLine(BaseModel):
    product_sku: str | None = None
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    qty: int


class DuplicateMatch(BaseModel):
    id: str
    doc_number: str
    status: str
    status_label: str
    created_at: str
    created_by_name: str | None = None
    lines: list[DuplicateMatchLine] = []


class DuplicateCheckResponse(BaseModel):
    matches: list[DuplicateMatch] = []
