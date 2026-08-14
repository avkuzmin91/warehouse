from __future__ import annotations

from pydantic import BaseModel, Field


class DispatchLineIn(BaseModel):
    product_id:   str
    product_name: str
    product_sku:  str
    color_id:     str | None = None
    color_name:   str | None = None
    size_id:      str | None = None
    size_name:    str | None = None
    qty:          int = Field(ge=1)
    pallets_qty:  int | None = Field(default=None, ge=0)
    boxes_qty:    int | None = Field(default=None, ge=0)
    site_url:     str | None = None
    store_id:     str | None = None
    store_name:   str | None = None


class DispatchDocCreate(BaseModel):
    cargo_type:     str = "good"
    client_id:      str | None = None
    client_name:    str | None = None
    destination:    str | None = None
    carrier:        str | None = None
    logistics_cost: float | None = None
    ship_date:      str | None = None
    comment:        str | None = None
    lines:          list[DispatchLineIn] = []


class DispatchDocUpdate(BaseModel):
    cargo_type:       str | None = None
    client_id:        str | None = None
    client_name:      str | None = None
    destination:      str | None = None
    carrier:          str | None = None
    logistics_cost:   float | None = None
    ship_date:        str | None = None
    priority_rank:    int | None = Field(default=None, ge=1, le=2)
    actual_ship_date: str | None = None
    comment:          str | None = None


class DispatchLineUpdate(BaseModel):
    qty:         int | None = Field(default=None, ge=1)
    pallets_qty: int | None = Field(default=None, ge=0)
    boxes_qty:   int | None = Field(default=None, ge=0)
    site_url:    str | None = None
    store_id:    str | None = None
    store_name:  str | None = None


class DispatchLinePalletsUpdate(BaseModel):
    pallets_qty: int | None = Field(default=None, ge=0)


class DispatchLineBoxesUpdate(BaseModel):
    boxes_qty: int | None = Field(default=None, ge=0)


class DispatchPriorityUpdate(BaseModel):
    priority_rank: int | None = Field(default=None, ge=1, le=2)


class DispatchPrepareSource(BaseModel):
    zone_id:   str
    zone_name: str | None = None
    qty:       int = Field(ge=1)


class DispatchPrepareLine(BaseModel):
    line_id: str
    sources: list[DispatchPrepareSource] = []


class DispatchFinishPreparationPayload(BaseModel):
    lines: list[DispatchPrepareLine] = []


class DispatchReturnToDraftPayload(BaseModel):
    reason: str | None = None


class DispatchLineFile(BaseModel):
    id:         str
    filename:   str
    url:        str
    mime_type:  str | None = None
    created_at: str


class DispatchLineItem(BaseModel):
    id:           str
    product_id:   str
    product_name: str
    product_sku:  str
    sku_pending:  bool = False
    color_id:     str | None
    color_name:   str | None
    size_id:      str | None
    size_name:    str | None
    qty:          int
    shipped_qty:  int
    pallets_qty:      int | None = None
    boxes_qty:        int | None = None
    items_per_box:    int | None = None
    boxes_per_pallet: int | None = None
    site_url:     str | None = None
    store_id:     str | None
    store_name:   str | None
    remaining:    int = 0
    files:        list[DispatchLineFile] = []


class DispatchReservationItem(BaseModel):
    product_id: str
    color_id:   str | None
    size_id:    str | None
    reserved:   int


class DispatchReservationsResponse(BaseModel):
    items: list[DispatchReservationItem]


class DispatchListItem(BaseModel):
    id:                str
    doc_number:        str
    cargo_type:        str
    client_id:         str | None
    client_name:       str | None
    destination:       str | None
    carrier:           str | None
    logistics_cost:    float | None
    ship_date:         str | None
    priority_rank:     int | None = None
    status:            str
    status_label:      str
    sku_count:         int
    total_qty:         int
    total_shipped_qty: int = 0
    closed_short:      bool = False
    created_at:        str
    created_by_name:   str | None = None


class DispatchListResponse(BaseModel):
    items: list[DispatchListItem]
    total: int
    page:  int
    limit: int


class DispatchLinesListItem(BaseModel):
    line_id:      str
    doc_id:       str
    doc_number:   str
    cargo_type:   str
    client_id:    str | None
    client_name:  str | None
    destination:  str | None
    ship_date:    str | None
    status:       str
    status_label: str
    product_id:   str
    product_name: str
    product_sku:  str
    color_name:   str | None
    size_name:    str | None
    qty:          int
    shipped_qty:  int
    store_name:   str | None


class DispatchLinesResponse(BaseModel):
    items: list[DispatchLinesListItem]
    total: int
    page:  int
    limit: int


class DispatchDuplicateCheckLine(BaseModel):
    product_id: str
    color_id:   str | None = None
    size_id:    str | None = None
    qty:        int = Field(ge=1)


class DispatchDuplicateCheck(BaseModel):
    cargo_type: str = "good"
    client_id:  str | None = None
    ship_date:  str | None = None
    lines:      list[DispatchDuplicateCheckLine] = []


class DuplicateMatchLine(BaseModel):
    product_sku:  str | None = None
    product_name: str | None = None
    color_name:   str | None = None
    size_name:    str | None = None
    qty:          int


class DuplicateMatch(BaseModel):
    id:              str
    doc_number:      str
    status:          str
    status_label:    str
    created_at:      str
    created_by_name: str | None = None
    lines:           list[DuplicateMatchLine] = []


class DuplicateCheckResponse(BaseModel):
    matches: list[DuplicateMatch] = []


class DispatchOpItem(BaseModel):
    id:               str
    op_type:          str
    comment:          str | None
    created_at:       str
    created_by:       str | None
    created_by_email: str | None = None


class TripRef(BaseModel):
    id:     str
    number: str


class DispatchDetailResponse(BaseModel):
    id:               str
    doc_number:       str
    cargo_type:       str
    client_id:        str | None
    client_name:      str | None
    destination:      str | None
    carrier:          str | None
    logistics_cost:   float | None
    ship_date:        str | None
    priority_rank:    int | None = None
    actual_ship_date: str | None = None
    comment:          str | None
    status:           str
    status_label:     str
    invoiced:         bool = False
    closed_short_at:  str | None = None
    can_close_short:  bool = False
    trips:            list[TripRef] = []
    created_at:       str
    created_by:       str | None
    created_by_name:  str | None = None
    updated_at:       str | None
    lines:            list[DispatchLineItem]
    ops:              list[DispatchOpItem]
    sku_count:        int
    total_qty:        int


class DispatchesSummaryResponse(BaseModel):
    all: int
    draft: int
    awaiting_packing: int
    preparing: int
    awaiting: int
    shipped: int


class DispatchTripAllocationEntry(BaseModel):
    trip_number: str
    trip_status: str
    direction: str | None = None
    destination: str | None = None
    qty: int
    allocated_by: str | None = None
    allocated_at: str | None = None


class DispatchTripAllocLine(BaseModel):
    line_id: str
    product_sku: str | None = None
    product_name: str | None = None
    color: str | None = None
    variant: str | None = None
    qty: int
    shipped_qty: int
    remaining: int
    allocations: list[DispatchTripAllocationEntry] = []


class DispatchTripAllocRemainingResponse(BaseModel):
    lines: list[DispatchTripAllocLine] = []
