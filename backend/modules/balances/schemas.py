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
    # Порядок размера из справочника (sizes.sort_order) — для сеток на клиенте.
    size_sort_order: int | None = None
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


class BalanceGroupItem(BaseModel):
    """Группа остатков «артикул × клиент»: агрегаты по корзинам + варианты.

    Варианты отсортированы по цвету, внутри цвета — по порядку размеров из
    справочника (sort_order, затем имя). Товар без цвета/размера — группа с
    единственным вариантом без color_id/size_id (фронт рисует плоской строкой)."""

    product_id: str
    product_name: str
    product_sku: str
    client_id: str | None
    client_name: str | None
    storage_good: int
    storage_defect: int
    packing_good: int
    packing_defect: int
    packed_good: int
    packed_defect: int
    ready_good: int
    ready_defect: int
    total: int
    variants_count: int
    colors_count: int
    sizes_count: int
    items: list[BalanceItem]


class BalanceGroupedResponse(BaseModel):
    items: list[BalanceGroupItem]
    # total — число групп (пагинация по группам, не по вариантам).
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
    # Упаковано, но ещё не размещено по местам (корзина packed). Для отгрузки годного —
    # такой же источник, как ready: можно отгрузить прямо со стола упаковки.
    packed_good: int = 0
    # На столе упаковки (корзина packing): снято со склада, ещё не упаковано. К отгрузке
    # недоступно (источник = ready + packed), показывается только как провенанс остатка.
    packing_good: int = 0
    storage_good: int
    storage_defect: int
    in_transit: int
    items_per_box: int | None = None
    boxes_per_pallet: int | None = None
    # ШК ровно этого варианта (цвет×размер) — для сверки позиции с коробкой/письмом клиента.
    barcodes: list[str] = []


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
    # Порядок размера из справочника (sizes.sort_order) — для сортировки сеток.
    size_sort_order: int | None = None
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
    # Операционный статус перемещаемого товара: меняется только место, статус и
    # качество фиксированы. Терминальные стоки и intake не перемещаются.
    op: Literal["storage", "packing", "packed", "ready"] = "storage"
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
    # Статус товара, у которого меняется качество. Вне «На хранении» разрешён только
    # перевод good → defect: брак выбывает из процесса и возвращается на хранение.
    op: Literal["storage", "packing", "packed", "ready"] = "storage"
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
    # Статус списываемого товара: списать можно из любого нетерминального бакета.
    op: Literal["storage", "packing", "packed", "ready"] = "storage"
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
    # Ссылка на оригинал (заполнена у записей-сторно) и признак, что запись уже откачена.
    reverses_id: str | None = None
    is_reversed: bool = False


class ZoneRelocationListResponse(BaseModel):
    items: list[ZoneRelocationItem]
    total: int
    page: int
    limit: int


class TurnoverTotals(BaseModel):
    """Итоги оборота по всей выборке (не по странице)."""
    opening: int = 0
    receipt: int = 0
    stock_entry: int = 0
    shipped: int = 0
    written_off: int = 0
    defect_in: int = 0
    defect_out: int = 0
    adjustments: int = 0
    closing: int = 0


class TurnoverItem(BaseModel):
    """Строка оборотной ведомости по позиции.

    Инвариант: closing = opening + receipt + stock_entry + adjustments − shipped − written_off
    ± переводы качества. defect_in/defect_out заполняются только при фильтре по качеству
    (перевод в брак: приход для среза «брак», расход для среза «годный»); без фильтра
    они равны 0 — общий остаток позиции переводы не меняют.
    """
    product_id: str
    product_name: str | None
    product_sku: str | None
    client_id: str | None
    client_name: str | None
    color_id: str | None
    color_name: str | None
    size_id: str | None
    size_name: str | None
    opening: int
    receipt: int
    stock_entry: int
    shipped: int
    written_off: int
    defect_in: int = 0
    defect_out: int = 0
    # Корректировки приёмки: со знаком (обычно отрицательные).
    adjustments: int
    closing: int


class TurnoverListResponse(BaseModel):
    items: list[TurnoverItem]
    totals: TurnoverTotals
    total: int
    page: int
    limit: int
    date_from: str | None = None
    date_to: str | None = None


class StockHistoryEvent(BaseModel):
    """Событие, изменившее остаток позиции (внутренние перемещения исключены)."""
    id: str
    created_at: str
    created_by_email: str | None
    kind: str
    quality: str
    qty: int
    # Знаковое изменение остатка позиции.
    delta: int
    # Остаток позиции после события.
    balance_after: int
    zone_name: str | None
    receipt_id: str | None = None
    receipt_number: str | None = None
    dispatch_id: str | None = None
    dispatch_number: str | None = None
    trip_id: str | None = None
    trip_number: str | None = None
    reason: str | None = None
    comment: str | None = None


class StockHistoryResponse(BaseModel):
    product_id: str
    product_name: str | None
    product_sku: str | None
    client_id: str | None
    client_name: str | None
    color_id: str | None
    color_name: str | None
    size_id: str | None
    size_name: str | None
    # Остаток до первого показанного события (при усечении длинной истории > 0).
    opening: int
    closing: int
    events: list[StockHistoryEvent]
    total_events: int
    truncated: bool = False
