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
