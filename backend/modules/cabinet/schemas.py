from __future__ import annotations

from pydantic import BaseModel


class CabinetMessage(BaseModel):
    message: str


class CabinetOpItem(BaseModel):
    op_type: str
    qty: int | None = None
    comment: str | None = None
    created_at: str


# --- Поступления ---

class CabinetReceiptListItem(BaseModel):
    id: str
    doc_number: str
    arrival_date: str | None = None
    actual_arrival_date: str | None = None
    status: str
    sku_count: int = 0
    total_planned: int = 0
    total_accepted_qty: int = 0
    created_at: str


class CabinetReceiptListResponse(BaseModel):
    items: list[CabinetReceiptListItem]
    total: int
    page: int
    limit: int


class CabinetReceiptLineItem(BaseModel):
    doc_id: str
    doc_number: str
    status: str
    arrival_date: str | None = None
    actual_arrival_date: str | None = None
    product_name: str
    product_sku: str
    color_name: str | None = None
    size_name: str | None = None
    planned_qty: int
    accepted_qty: int | None = None


class CabinetReceiptLinesResponse(BaseModel):
    items: list[CabinetReceiptLineItem]
    total: int
    page: int
    limit: int


class CabinetReceiptDoc(BaseModel):
    id: str
    doc_number: str
    arrival_date: str | None = None
    actual_arrival_date: str | None = None
    ttn: str | None = None
    status: str
    created_at: str


class CabinetReceiptLine(BaseModel):
    product_name: str
    product_sku: str
    color_name: str | None = None
    size_name: str | None = None
    planned_qty: int
    accepted_qty: int | None = None


class CabinetReceiptTotals(BaseModel):
    total_planned: int = 0
    total_accepted: int = 0


class CabinetReceiptDetailResponse(BaseModel):
    doc: CabinetReceiptDoc
    lines: list[CabinetReceiptLine]
    ops: list[CabinetOpItem]
    totals: CabinetReceiptTotals


# --- Отгрузки ---

class CabinetShipmentListItem(BaseModel):
    id: str
    doc_number: str
    cargo_type: str
    store_names: list[str] = []
    ship_date: str | None = None
    actual_ship_date: str | None = None
    status: str
    sku_count: int = 0
    total_qty: int = 0
    total_packed_qty: int = 0
    total_shipped_qty: int = 0
    created_at: str


class CabinetShipmentListResponse(BaseModel):
    items: list[CabinetShipmentListItem]
    total: int
    page: int
    limit: int


class CabinetShipmentLineItem(BaseModel):
    doc_id: str
    doc_number: str
    cargo_type: str
    status: str
    ship_date: str | None = None
    product_name: str
    product_sku: str
    color_name: str | None = None
    size_name: str | None = None
    qty: int
    shipped_qty: int = 0
    store_name: str | None = None


class CabinetShipmentLinesResponse(BaseModel):
    items: list[CabinetShipmentLineItem]
    total: int
    page: int
    limit: int


class CabinetLineFile(BaseModel):
    filename: str
    url: str


class CabinetShipmentDoc(BaseModel):
    id: str
    doc_number: str
    cargo_type: str
    ship_date: str | None = None
    actual_ship_date: str | None = None
    status: str
    created_at: str


class CabinetShipmentLine(BaseModel):
    id: str
    product_name: str
    product_sku: str
    color_name: str | None = None
    size_name: str | None = None
    qty: int
    shipped_qty: int = 0
    packed_good: int = 0
    packed_defect: int = 0
    store_name: str | None = None
    files: list[CabinetLineFile] = []


class CabinetShipmentDetailResponse(BaseModel):
    doc: CabinetShipmentDoc
    lines: list[CabinetShipmentLine]
    ops: list[CabinetOpItem]


# --- Списания ---

class CabinetWriteOffItem(BaseModel):
    id: str
    created_at: str
    product_name: str | None = None
    product_sku: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    quality: str
    qty: int
    reason: str | None = None
    comment: str | None = None


class CabinetWriteOffsResponse(BaseModel):
    items: list[CabinetWriteOffItem]
    total: int
    page: int
    limit: int


# --- Сводка ---

class CabinetBalanceTotals(BaseModel):
    storage_good: int = 0
    packing_good: int = 0
    ready_good: int = 0
    total_good: int = 0
    defect_total: int = 0


class CabinetEventItem(BaseModel):
    doc_kind: str  # 'receipt' | 'shipment'
    doc_id: str
    doc_number: str
    op_type: str
    qty: int | None = None
    comment: str | None = None
    created_at: str


class CabinetSummaryResponse(BaseModel):
    totals: CabinetBalanceTotals
    active_receipts: list[CabinetReceiptListItem]
    active_shipments: list[CabinetShipmentListItem]
    events: list[CabinetEventItem]


# --- Отчёт «Упаковка по дням» ---

class CabinetPackingReportRow(BaseModel):
    product_sku: str | None = None
    product_name: str | None = None
    good: int
    defect: int
    total: int


class CabinetPackingReportDay(BaseModel):
    packed_date: str
    good: int
    defect: int
    total: int
    sku_count: int
    doc_count: int
    rows: list[CabinetPackingReportRow]


class CabinetPackingReportResponse(BaseModel):
    days: list[CabinetPackingReportDay]
    total_good: int
    total_defect: int
    total: int


# --- Профиль ---

class CabinetClientInfo(BaseModel):
    id: str
    name: str


class CabinetStoreItem(BaseModel):
    id: str
    name: str
    is_active: bool


class CabinetProfileResponse(BaseModel):
    client: CabinetClientInfo
    stores: list[CabinetStoreItem]
