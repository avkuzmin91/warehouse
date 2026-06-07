from __future__ import annotations

from pydantic import BaseModel, Field


class ShipmentLineIn(BaseModel):
    product_id:        str
    product_name:      str
    product_sku:       str
    color_id:          str | None = None
    color_name:        str | None = None
    size_id:           str | None = None
    size_name:         str | None = None
    qty:               int = Field(ge=1)
    shipped_qty:       int = Field(ge=0, default=0)
    packed_qty:        int = Field(ge=0, default=0)
    storage_zone_id:   str | None = None
    storage_zone_name: str | None = None
    store_id:          str | None = None
    store_name:        str | None = None


class ShipmentLinePackPayload(BaseModel):
    delta: int
    kind: str = "good"  # 'good' | 'defect'


class ShipmentMoveToPackingPayload(BaseModel):
    qty: int = Field(ge=1)
    from_zone_id: str | None = None


class ShipmentDocCreate(BaseModel):
    cargo_type:      str = "good"
    client_id:       str | None = None
    client_name:     str | None = None
    destination:     str | None = None
    carrier:         str | None = None
    logistics_cost:  float | None = None
    ship_date:       str | None = None
    comment:         str | None = None
    lines:           list[ShipmentLineIn] = []


class ShipmentDocUpdate(BaseModel):
    cargo_type:      str | None = None
    client_id:       str | None = None
    client_name:     str | None = None
    destination:     str | None = None
    carrier:         str | None = None
    logistics_cost:  float | None = None
    ship_date:       str | None = None
    actual_ship_date: str | None = None
    comment:         str | None = None


class ShipmentLineFile(BaseModel):
    id:         str
    filename:   str
    url:        str
    mime_type:  str | None = None
    created_at: str


class ShipmentLineItem(BaseModel):
    id:                str
    product_id:        str
    product_name:      str
    product_sku:       str
    color_id:          str | None
    color_name:        str | None
    size_id:           str | None
    size_name:         str | None
    qty:               int
    shipped_qty:       int
    packed_qty:        int = 0
    packed_good:       int = 0
    packed_defect:     int = 0
    review_in_packing: int = 0
    storage_zone_id:   str | None
    storage_zone_name: str | None
    store_id:          str | None
    store_name:        str | None
    files:             list[ShipmentLineFile] = []


class ShipmentListItem(BaseModel):
    id:           str
    doc_number:   str
    cargo_type:   str
    client_id:    str | None
    client_name:  str | None
    destination:  str | None
    carrier:      str | None
    logistics_cost: float | None
    ship_date:    str | None
    status:       str
    status_label: str
    sku_count:    int
    total_qty:    int
    total_shipped_qty: int = 0
    total_packed_qty: int = 0
    lines_with_shipped_qty: int = 0
    lines_with_packed_qty: int = 0
    lines_with_zone: int = 0
    created_at:   str


class ShipmentListResponse(BaseModel):
    items: list[ShipmentListItem]
    total: int
    page:  int
    limit: int


class ShipmentLinesListItem(BaseModel):
    line_id:           str
    doc_id:            str
    doc_number:        str
    cargo_type:        str
    client_id:         str | None
    client_name:       str | None
    destination:       str | None
    ship_date:         str | None
    status:            str
    status_label:      str
    product_id:        str
    product_name:      str
    product_sku:       str
    color_name:        str | None
    size_name:         str | None
    qty:               int
    shipped_qty:       int
    packed_qty:        int = 0
    storage_zone_name: str | None
    store_name:        str | None


class ShipmentLinesResponse(BaseModel):
    items: list[ShipmentLinesListItem]
    total: int
    page:  int
    limit: int


class ShipmentOpItem(BaseModel):
    id:               str
    op_type:          str
    comment:          str | None
    created_at:       str
    created_by:       str | None
    created_by_email: str | None


class ShipmentDetailResponse(BaseModel):
    id:           str
    doc_number:   str
    cargo_type:   str
    client_id:    str | None
    client_name:  str | None
    destination:  str | None
    carrier:      str | None
    logistics_cost: float | None
    ship_date:    str | None
    actual_ship_date: str | None = None
    comment:      str | None
    status:       str
    status_label: str
    trip_id:      str | None = None
    trip_number:  str | None = None
    created_at:   str
    created_by:   str | None
    updated_at:   str | None
    lines:        list[ShipmentLineItem]
    ops:          list[ShipmentOpItem]
    sku_count:    int
    total_qty:    int
