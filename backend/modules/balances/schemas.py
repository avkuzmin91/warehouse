from __future__ import annotations

from pydantic import BaseModel


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
