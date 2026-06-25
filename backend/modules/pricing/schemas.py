from __future__ import annotations

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


class PricedProductItem(BaseModel):
    id: str
    name: str
    sku: str | None = None
    sku_pending: bool = False
    client_id: str | None = None
    client_name: str | None = None
    good_price_kop: int | None = None
    defect_price_kop: int | None = None
    has_price: bool = False


class PricedProductsResponse(BaseModel):
    items: list[PricedProductItem]
    total: int
    page: int
    limit: int


class PriceHistoryEntry(BaseModel):
    id: str
    price_kop: int
    effective_from: str
    note: str | None = None
    created_at: str
    created_by: str | None = None


class ProductPriceDetail(BaseModel):
    product_id: str
    product_name: str
    sku: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    good_price_kop: int | None = None
    defect_price_kop: int | None = None
    good_history: list[PriceHistoryEntry]
    defect_history: list[PriceHistoryEntry]


class SetPriceRequest(BaseModel):
    client_id: str | None = None
    good_price_kop: int | None = Field(default=None, ge=0)
    defect_price_kop: int | None = Field(default=None, ge=0)
    effective_from: str | None = None
    note: str | None = None
