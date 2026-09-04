from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from config import INV_Q_GOOD


class ContainerItem(BaseModel):
    """Короб: тара задачи «Размещение по ячейкам»."""

    id: str
    doc_number: str          # человекочитаемый номер «BOX-000123» (он же на этикетке)
    status: str              # new | open | closed | placed
    doc_id: str | None = None
    doc_number_task: str | None = None   # номер задачи размещения, в которой собран
    client_id: str | None = None
    client_name: str | None = None
    store_id: str | None = None
    store_name: str | None = None
    zone_id: str | None = None
    zone_name: str | None = None
    items_qty: int = 0
    created_at: str
    closed_at: str | None = None
    placed_at: str | None = None


class ContainerContentLine(BaseModel):
    # Строка задания, к которой отнесён товар в коробе — по ней его и изымают.
    line_id: str | None = None
    product_id: str
    product_name: str | None = None
    product_sku: str | None = None
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    quality: str = INV_Q_GOOD
    qty: int


class ContainerOpItem(BaseModel):
    id: str
    op_type: str
    product_name: str | None = None
    product_sku: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    qty: int | None = None
    zone_name: str | None = None
    comment: str | None = None
    created_at: str
    created_by: str | None = None
    created_by_name: str | None = None


class ContainerDetailResponse(BaseModel):
    doc: ContainerItem
    contents: list[ContainerContentLine] = []
    ops: list[ContainerOpItem] = []


class ContainerListResponse(BaseModel):
    items: list[ContainerItem]
    total: int
    page: int
    limit: int


class ContainerLookupResponse(BaseModel):
    found: bool
    container: ContainerItem | None = None


class ContainerBatchCreate(BaseModel):
    count: int = Field(ge=1, le=200)


class ContainerBatchResult(BaseModel):
    items: list[ContainerItem]


class ContainerDeleteRequest(BaseModel):
    """Удаление ошибочно заведённой пачки: только свободные, ни разу не пущенные в дело."""

    ids: list[str] = Field(min_length=1)


class ContainerDeleteResult(BaseModel):
    deleted: int = 0
    skipped: int = 0
    # Номера коробов, которые удалить нельзя (уже в работе) — их называют пользователю.
    skipped_numbers: list[str] = []


class ContainerLabel(BaseModel):
    id: str
    doc_number: str
    payload: str  # содержимое QR: «wms:box:<id>»
    qr_svg: str


class ContainerLabelsResponse(BaseModel):
    items: list[ContainerLabel]


class ContainerMoveRequest(BaseModel):
    zone_id: str = Field(min_length=1)


class ContainerPlaceItemScan(BaseModel):
    """Скан товара: собранного мимо короба либо взятого с полки для переноса.

    from_zone_id — место-источник («взял отсюда»). Без него товар ищется сам:
    сначала среди ждущего размещения, затем на хранении; неоднозначность
    (несколько мест или оба качества) отдаётся ошибкой, а не угадывается.
    quality не обязателен по той же причине.
    """

    barcode: str | None = None
    # Веб работает без сканера: там позиция приходит вариантом, а не штрих-кодом.
    product_id: str | None = None
    color_id: str | None = None
    size_id: str | None = None
    qty: int = Field(ge=1, default=1)
    quality: str | None = None
    from_zone_id: str | None = None


class ContainerPlaceSource(BaseModel):
    """«Откуда» одной ходки: зона упаковки (корзина «ждёт размещения»), место или размещённый короб.

    Относится ко всей пачке и имеет приоритет над `from_zone_id` в строках. Без
    источника товар ищется сам (сначала ждущее размещения, затем полка), а короб
    решает по статусу; с источником он ещё и сверяется: короб, который числится в
    другом месте, — ошибка учёта, а не повод молча поправить.
    """

    kind: Literal["collected", "location", "container"]
    id: str | None = None


class ContainerPlaceTarget(BaseModel):
    """«Куда»: место хранения либо размещённый короб (только для товара)."""

    kind: Literal["location", "container"]
    id: str = Field(min_length=1)


class ContainerPlaceRequest(BaseModel):
    """Пачка коробов и/или товара в одно место (сессия «откуда → что → куда»).

    `zone_id` — приёмник-место в старой форме запроса; `target` его заменяет.
    """

    zone_id: str | None = None
    source: ContainerPlaceSource | None = None
    target: ContainerPlaceTarget | None = None
    box_ids: list[str] = []
    items: list[ContainerPlaceItemScan] = []


class ContainerPlacedItem(BaseModel):
    """Строка перемещённого товара: что, сколько и откуда уехало в место хранения."""

    product_name: str | None = None
    product_sku: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    quality: str
    qty: int
    # false — товар взят с полки (перенос), true — собранное, ждавшее размещения.
    from_collected: bool = True


class ContainerPlaceResult(BaseModel):
    zone_id: str
    zone_name: str
    # Товар доложен в размещённый короб: место — то, где стоит короб.
    target_container: ContainerItem | None = None
    boxes: list[ContainerItem] = []
    items: list[ContainerPlacedItem] = []
    placed_qty: int = 0


class ContainerPendingBox(BaseModel):
    """Закрытый короб у стола: ждёт, когда его увезут в место хранения."""

    id: str
    doc_number: str
    client_name: str | None = None
    items_qty: int = 0
    closed_at: str | None = None


class ContainerPendingAsideItem(BaseModel):
    """Собранное мимо короба (габарит, брак): короба у него нет, только корзина boxed."""

    product_id: str
    product_name: str | None = None
    product_sku: str | None = None
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    client_name: str | None = None
    quality: str
    qty: int = 0


class ContainerPendingPlacement(BaseModel):
    """Очередь развозки: что закрыто у стола и ещё не уехало в место хранения."""

    boxes: list[ContainerPendingBox] = []
    boxes_qty: int = 0
    aside: list[ContainerPendingAsideItem] = []
    aside_qty: int = 0
    # Самый старый объект очереди: по нему видно, что стоит у стола давно.
    since: str | None = None


class ContainerItemRemoveRequest(BaseModel):
    """Изъятие позиции из размещённого короба: товар остаётся в том же месте россыпью.

    Позиция приходит сканом (ТСД) либо вариантом (веб — там сканера нет).
    """

    barcode: str | None = None
    product_id: str | None = None
    color_id: str | None = None
    size_id: str | None = None
    qty: int = Field(ge=1, default=1)


class ContainerHoldingRow(BaseModel):
    """Что из позиции лежит в коробе в этом месте — раскладка строки остатка по таре."""

    zone_id: str
    zone_name: str | None = None
    product_id: str
    color_id: str | None = None
    size_id: str | None = None
    client_id: str | None = None
    quality: str
    op_status: str
    container_id: str
    doc_number: str
    status: str
    qty: int


class ContainerHoldingsResponse(BaseModel):
    items: list[ContainerHoldingRow]
