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
