from __future__ import annotations

from pydantic import BaseModel, Field


class ReceiptDocCreate(BaseModel):
    client_id: str
    supplier_name: str | None = None
    arrival_date: str | None = None
    zone_id: str | None = None
    zone_name: str | None = None
    ttn: str | None = None
    logistics_cost: float | None = None
    lines: list["ReceiptLineCreate"] = []


class ReceiptLineCreate(BaseModel):
    product_id: str
    product_name: str
    product_sku: str
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    planned_qty: int = Field(ge=1)


class ReceiptDocUpdate(BaseModel):
    client_id: str | None = None
    supplier_name: str | None = None
    arrival_date: str | None = None
    zone_id: str | None = None
    zone_name: str | None = None
    ttn: str | None = None
    logistics_cost: float | None = None


class ReceiptLineAdd(BaseModel):
    product_id: str
    product_name: str
    product_sku: str
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    planned_qty: int = Field(ge=1)


class ReceiptLineUpdate(BaseModel):
    planned_qty: int | None = Field(default=None, ge=1)
    accepted_qty: int | None = Field(default=None, ge=0)
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    good_zone_id: str | None = None
    good_zone_name: str | None = None
    defect_zone_id: str | None = None
    defect_zone_name: str | None = None


class ReceiptArriveLine(BaseModel):
    line_id: str
    accepted_qty: int = Field(ge=0)


class ReceiptArrivePayload(BaseModel):
    lines: list[ReceiptArriveLine] = []


class ReceiptOpRecord(BaseModel):
    line_id: str
    op_type: str  # receiving | defect_fix | receiving_correction | defect_correction
    qty: int = Field(ge=0)
    reason: str | None = None
    comment: str | None = None


class ReceiptLineQcComplete(BaseModel):
    accepted: int | None = None
    defect: int | None = None


class ReceiptDocResponse(BaseModel):
    id: str
    doc_number: str
    client_id: str
    client_name: str | None = None
    supplier_name: str | None = None
    arrival_date: str | None = None
    status: str
    zone_id: str | None = None
    zone_name: str | None = None
    ttn: str | None = None
    logistics_cost: float
    created_at: str
    created_by: str | None = None
    updated_at: str | None = None


class ReceiptLineResponse(BaseModel):
    id: str
    doc_id: str
    product_id: str
    product_name: str
    product_sku: str
    color_id: str | None = None
    color_name: str | None = None
    size_id: str | None = None
    size_name: str | None = None
    storage_zone_id: str | None = None
    storage_zone_name: str | None = None
    good_zone_id: str | None = None
    good_zone_name: str | None = None
    defect_zone_id: str | None = None
    defect_zone_name: str | None = None
    planned_qty: int
    accepted_qty: int | None = None
    accepted: int = 0
    defect: int = 0
    ops_count: int = 0
    qc_status: str = "pending"
    created_at: str


class ReceiptOpResponse(BaseModel):
    id: str
    doc_id: str
    line_id: str | None = None
    op_type: str
    qty: int | None = None
    reason: str | None = None
    comment: str | None = None
    created_at: str
    created_by: str | None = None
    created_by_email: str | None = None


class ReceiptDetailResponse(BaseModel):
    doc: ReceiptDocResponse
    lines: list[ReceiptLineResponse]
    ops: list[ReceiptOpResponse]
    state: dict


class ReceiptListItem(BaseModel):
    id: str
    doc_number: str
    client_id: str
    client_name: str | None = None
    supplier_name: str | None = None
    arrival_date: str | None = None
    status: str
    zone_id: str | None = None
    zone_name: str | None = None
    ttn: str | None = None
    logistics_cost: float
    created_at: str
    created_by: str | None = None
    sku_count: int = 0
    total_planned: int = 0
    total_accepted_qty: int = 0
    total_accepted: int = 0
    total_defect: int = 0


class ReceiptListResponse(BaseModel):
    items: list[ReceiptListItem]
    total: int
    page: int
    limit: int
