from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class BalanceItem(BaseModel):
    product_id: str
    product_name: str
    product_sku: str
    client_id: str | None
    client_name: str | None
    color_id: str | None
    color_name: str | None
    size_id: str | None
    size_name: str | None
    good: int
    defect: int
    on_review: int
    on_packing: int = 0
    total: int
    docs_count: int


class BalanceListResponse(BaseModel):
    items: list[BalanceItem]
    total: int
    page: int
    limit: int


class BalanceZoneItem(BaseModel):
    location_id: str | None
    location_name: str | None
    status: str  # 'good' | 'defect' | 'on_review'
    product_id: str
    product_name: str
    product_sku: str
    client_id: str | None
    client_name: str | None
    color_id: str | None
    color_name: str | None
    size_id: str | None
    size_name: str | None
    qty: int


class BalanceZonesResponse(BaseModel):
    items: list[BalanceZoneItem]


class ZoneRelocationCreate(BaseModel):
    product_id: str
    product_name: str | None = None
    product_sku: str | None = None
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    status: Literal["good", "defect", "on_review"]
    from_zone_id: str | None = None
    to_zone_id: str | None = None
    qty: int = Field(ge=1)
    comment: str | None = None


class ZoneRelocationItem(BaseModel):
    id: str
    created_at: str
    created_by_email: str | None
    status: str
    product_name: str | None
    product_sku: str | None
    color_name: str | None
    size_name: str | None
    client_name: str | None
    from_zone_name: str | None
    to_zone_name: str | None
    qty: int
    comment: str | None


class ZoneRelocationListResponse(BaseModel):
    items: list[ZoneRelocationItem]
    total: int
    page: int
    limit: int
