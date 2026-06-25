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
    # Корзины: операционный статус × качество.
    storage_good: int
    storage_defect: int
    packing_good: int
    packing_defect: int
    packed_good: int
    packed_defect: int
    ready_good: int
    ready_defect: int
    total: int
    docs_count: int


class BalanceListResponse(BaseModel):
    items: list[BalanceItem]
    total: int
    page: int
    limit: int


class PlannableItem(BaseModel):
    """Позиция, доступная для планирования отгрузки: остаток на складе + товар в пути.

    `in_transit` — заявленное, но ещё не приехавшее (planned − accepted по активным
    поступлениям). Менеджер может положить такую позицию в черновик отгрузки, а
    перевести в план — только когда товар появится на остатках (storage_good)."""

    product_id: str
    product_name: str
    product_sku: str
    sku_pending: bool = False
    client_id: str | None
    client_name: str | None
    color_id: str | None
    color_name: str | None
    size_id: str | None
    size_name: str | None
    ready_good: int = 0
    ready_defect: int = 0
    storage_good: int
    storage_defect: int
    in_transit: int
    items_per_pallet: int | None = None


class PlannableListResponse(BaseModel):
    items: list[PlannableItem]


class BalanceSummaryResponse(BaseModel):
    """Итоги по всем позициям (не зависят от пагинации списка)."""

    storage_good: int
    storage_defect: int
    packing_good: int
    packing_defect: int
    packed_good: int
    packed_defect: int
    ready_good: int
    ready_defect: int
    total: int


class BalanceZoneItem(BaseModel):
    location_id: str | None
    location_name: str | None
    op_status: str  # 'storage' | 'packing' | 'packed' | 'ready'
    quality: str    # 'good' | 'defect'
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
    # Выборка обрезана лимитом — список неполный (итоги считать по /balances/summary).
    # Актуально только для режима без пагинации (mobile); в режиме с limit всегда False.
    truncated: bool = False
    # Пагинация по местоположениям (заполняется, когда запрошен limit). total — число
    # местоположений (страница = total/limit), а не строк.
    total: int = 0
    page: int = 1
    limit: int = 0


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
    quality: Literal["good", "defect"]
    from_zone_id: str | None = None
    to_zone_id: str | None = None
    qty: int = Field(ge=1)
    comment: str | None = None


class QualityChangeCreate(BaseModel):
    product_id: str
    product_name: str | None = None
    product_sku: str | None = None
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    zone_id: str
    from_quality: Literal["good", "defect"]
    to_quality: Literal["good", "defect"]
    qty: int = Field(ge=1)
    comment: str | None = None


class WriteOffCreate(BaseModel):
    product_id: str
    product_name: str | None = None
    product_sku: str | None = None
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    client_id: str | None = None
    client_name: str | None = None
    zone_id: str
    quality: Literal["good", "defect"]
    qty: int = Field(ge=1)
    reason: Literal["shortage", "damage", "disposal", "client_return", "other"]
    comment: str | None = None


class StockEntryLine(BaseModel):
    product_id: str
    product_name: str
    product_sku: str
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    zone_id: str
    quality: Literal["good", "defect"] = "good"
    qty: int = Field(ge=1)


class StockEntryCreate(BaseModel):
    """Историческое заведение остатков — то, что лежало на складе до системы.

    Без документа/маршрута: каждая строка пишется журнальным движением
    intake→storage@место. Привязка к клиенту обязательна (остатки — по клиенту).
    """
    client_id: str
    comment: str | None = None
    lines: list[StockEntryLine] = Field(default_factory=list)


class ZoneRelocationItem(BaseModel):
    id: str
    created_at: str
    created_by_email: str | None
    from_op: str
    to_op: str
    from_quality: str
    to_quality: str
    product_name: str | None
    product_sku: str | None
    color_name: str | None
    size_name: str | None
    client_name: str | None
    from_zone_name: str | None
    to_zone_name: str | None
    qty: int
    reason: str | None = None
    comment: str | None


class ZoneRelocationListResponse(BaseModel):
    items: list[ZoneRelocationItem]
    total: int
    page: int
    limit: int
