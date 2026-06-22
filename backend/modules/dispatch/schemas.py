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
    qty:        int | None = Field(default=None, ge=1)
    site_url:   str | None = None
    store_id:   str | None = None
    store_name: str | None = None


class DispatchPriorityUpdate(BaseModel):
    priority_rank: int | None = Field(default=None, ge=1, le=2)


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
    site_url:     str | None = None
    store_id:     str | None
    store_name:   str | None
    remaining:    int = 0


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
    created_at:        str


class DispatchListResponse(BaseModel):
    items: list[DispatchListItem]
    total: int
    page:  int
    limit: int


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
    trips:            list[TripRef] = []
    created_at:       str
    created_by:       str | None
    updated_at:       str | None
    lines:            list[DispatchLineItem]
    ops:              list[DispatchOpItem]
    sku_count:        int
    total_qty:        int
