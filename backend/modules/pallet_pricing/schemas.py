from __future__ import annotations

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


class ClientPalletPriceItem(BaseModel):
    client_id: str
    client_name: str
    price_kop: int | None = None
    has_price: bool = False


class ClientPalletPricesResponse(BaseModel):
    items: list[ClientPalletPriceItem]
    total: int
    page: int
    limit: int


class PalletPriceHistoryEntry(BaseModel):
    id: str
    price_kop: int
    effective_from: str
    note: str | None = None
    created_at: str
    created_by: str | None = None


class ClientPalletPriceDetail(BaseModel):
    client_id: str
    client_name: str
    price_kop: int | None = None
    history: list[PalletPriceHistoryEntry]


class SetPalletPriceRequest(BaseModel):
    price_kop: int = Field(ge=0)
    effective_from: str | None = None
    note: str | None = None
