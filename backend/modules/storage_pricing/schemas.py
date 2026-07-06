from __future__ import annotations

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


# ── Справочник тарифов ────────────────────────────────────────────────────────

class ClientStoragePriceItem(BaseModel):
    client_id: str
    client_name: str
    unit: str | None = None
    unit_label: str | None = None
    price_kop: int | None = None
    free_days: int | None = None
    has_price: bool = False


class ClientStoragePricesResponse(BaseModel):
    items: list[ClientStoragePriceItem]
    total: int
    page: int
    limit: int


class StoragePriceHistoryEntry(BaseModel):
    id: str
    unit: str
    price_kop: int
    free_days: int
    effective_from: str
    note: str | None = None
    created_at: str
    created_by: str | None = None


class ClientStoragePriceDetail(BaseModel):
    client_id: str
    client_name: str
    unit: str | None = None
    price_kop: int | None = None
    free_days: int | None = None
    billing_start: str | None = None
    history: list[StoragePriceHistoryEntry]


class SetStoragePriceRequest(BaseModel):
    unit: str
    price_kop: int = Field(ge=0)
    free_days: int = Field(ge=0, le=3650)
    effective_from: str | None = None
    note: str | None = None


class UninvoicedStorageMonth(BaseModel):
    month: str
    month_label: str
    days: int
    date_from: str
    date_to: str
    amount_kop: int


class UninvoicedStorageResponse(BaseModel):
    items: list[UninvoicedStorageMonth]
    total_amount_kop: int


# ── Отчёт «Хранение» ─────────────────────────────────────────────────────────

class StorageReportItem(BaseModel):
    client_id: str
    client_name: str | None = None
    billable_days: int
    amount_kop: int
    uninvoiced_kop: int
    missing_capacity_qty: int
    last_charge_date: str | None = None
    unit: str | None = None
    rate_kop: int | None = None
    free_days: int | None = None


class StorageReportResponse(BaseModel):
    items: list[StorageReportItem]
    total_amount_kop: int
    total_uninvoiced_kop: int


class StorageDayItem(BaseModel):
    id: str
    charge_date: str
    unit: str
    unit_label: str
    rate_kop: int
    free_days: int
    qty_pieces: int
    units_qty: int
    amount_kop: int
    missing_capacity_qty: int
    invoice_id: str | None = None
    invoice_number: str | None = None


class StorageClientDaysResponse(BaseModel):
    items: list[StorageDayItem]


class StorageChargeLineItem(BaseModel):
    id: str
    receipt_line_id: str | None = None
    receipt_doc_id: str | None = None
    receipt_doc_number: str | None = None
    product_id: str | None = None
    product_sku: str | None = None
    product_name: str | None = None
    color_name: str | None = None
    size_name: str | None = None
    accepted_on: str | None = None
    age_days: int
    qty_pieces: int
    billable_qty: int


class StorageChargeDetailResponse(BaseModel):
    id: str
    client_id: str
    client_name: str | None = None
    charge_date: str
    unit: str
    unit_label: str
    rate_kop: int
    free_days: int
    qty_pieces: int
    units_qty: int
    amount_kop: int
    missing_capacity_qty: int
    lines: list[StorageChargeLineItem]
