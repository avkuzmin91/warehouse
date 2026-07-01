from __future__ import annotations

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


class ClientBoxPriceItem(BaseModel):
    client_id: str
    client_name: str
    price_kop: int | None = None
    has_price: bool = False


class ClientBoxPricesResponse(BaseModel):
    items: list[ClientBoxPriceItem]
    total: int
    page: int
    limit: int


class BoxPriceHistoryEntry(BaseModel):
    id: str
    price_kop: int
    effective_from: str
    note: str | None = None
    created_at: str
    created_by: str | None = None


class ClientBoxPriceDetail(BaseModel):
    client_id: str
    client_name: str
    price_kop: int | None = None
    history: list[BoxPriceHistoryEntry]


class SetBoxPriceRequest(BaseModel):
    price_kop: int = Field(ge=0)
    effective_from: str | None = None
    note: str | None = None
