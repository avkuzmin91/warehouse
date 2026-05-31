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
    storage_zone_id:   str | None = None
    storage_zone_name: str | None = None


class ShipmentLineZoneIn(BaseModel):
    storage_zone_id:   str | None = None
    storage_zone_name: str | None = None
    qty:               int = Field(ge=1)


class ShipmentLineZonesSet(BaseModel):
    zones: list[ShipmentLineZoneIn] = []


class ShipmentLineZoneItem(BaseModel):
    id:                str
    storage_zone_id:   str | None
    storage_zone_name: str | None
    qty:               int


class ShipmentDocCreate(BaseModel):
    cargo_type:  str = "good"
    client_id:   str | None = None
    client_name: str | None = None
    destination: str | None = None
    carrier:     str | None = None
    ship_date:   str | None = None
    comment:     str | None = None
    lines:       list[ShipmentLineIn] = []


class ShipmentDocUpdate(BaseModel):
    cargo_type:  str | None = None
    client_id:   str | None = None
    client_name: str | None = None
    destination: str | None = None
    carrier:     str | None = None
    ship_date:   str | None = None
    comment:     str | None = None


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
    storage_zone_id:   str | None
    storage_zone_name: str | None
    zones:             list[ShipmentLineZoneItem] = []


class ShipmentListItem(BaseModel):
    id:           str
    doc_number:   str
    cargo_type:   str
    client_id:    str | None
    client_name:  str | None
    destination:  str | None
    carrier:      str | None
    ship_date:    str | None
    status:       str
    status_label: str
    sku_count:    int
    total_qty:    int
    total_shipped_qty: int = 0
    lines_with_shipped_qty: int = 0
    lines_with_zone: int = 0
    created_at:   str


class ShipmentListResponse(BaseModel):
    items: list[ShipmentListItem]
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
    ship_date:    str | None
    comment:      str | None
    status:       str
    status_label: str
    created_at:   str
    created_by:   str | None
    updated_at:   str | None
    lines:        list[ShipmentLineItem]
    ops:          list[ShipmentOpItem]
    sku_count:    int
    total_qty:    int
