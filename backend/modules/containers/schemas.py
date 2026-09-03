from __future__ import annotations

from pydantic import BaseModel, Field


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
    """Скан товара, собранного мимо короба (габарит, брак).

    quality не обязателен: если по ШК ждёт размещения товар только одного качества,
    он определяется сам — у стеллажа кладовщику незачем решать за упаковщика.
    """

    barcode: str = Field(min_length=1)
    qty: int = Field(ge=1, default=1)
    quality: str | None = None


class ContainerPlaceRequest(BaseModel):
    """Пачка коробов и/или товара в одно место хранения (сессия «взял → положил»)."""

    zone_id: str = Field(min_length=1)
    box_ids: list[str] = []
    items: list[ContainerPlaceItemScan] = []


class ContainerPlacedItem(BaseModel):
    """Строка размещённой россыпи: что и сколько уехало в место хранения."""

    product_name: str | None = None
    product_sku: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    quality: str
    qty: int


class ContainerPlaceResult(BaseModel):
    zone_id: str
    zone_name: str
    boxes: list[ContainerItem] = []
    items: list[ContainerPlacedItem] = []
    placed_qty: int = 0
    # Номера задач размещения, которые закрылись этим размещением (последний объект).
    closed_tasks: list[str] = []


class ContainerItemRemoveRequest(BaseModel):
    """Изъятие позиции из размещённого короба: товар остаётся в том же месте россыпью."""

    barcode: str = Field(min_length=1)
    qty: int = Field(ge=1, default=1)
