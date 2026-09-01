from __future__ import annotations

from pydantic import BaseModel, Field


class MarkingScanCreate(BaseModel):
    """Сырая строка со сканера. Разбирает её сервер: ключ уникальности реестра
    не должен зависеть от того, что посчитал клиент."""

    raw: str = Field(min_length=1)


class MarkingCodeItem(BaseModel):
    id: str
    gtin: str
    serial: str
    raw: str
    variant_id: str | None = None
    product_id: str | None = None
    product_name: str | None = None
    sku: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    is_exact: bool
    created_at: str | None = None
    created_by_email: str | None = None


class MarkingScanResponse(BaseModel):
    # duplicate — код уже в реестре; в code лежит ранее сохранённая запись,
    # чтобы оператор увидел, когда и кто его отсканировал.
    status: str
    code: MarkingCodeItem


class MarkingCodeListResponse(BaseModel):
    items: list[MarkingCodeItem]
    total: int
    page: int
    limit: int
