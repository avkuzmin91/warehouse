from __future__ import annotations

from pydantic import BaseModel, Field


class InvoiceCreate(BaseModel):
    client_id:    str                            # единственное обязательное поле черновика
    client_name:  str | None = None
    due_date:     str | None = None              # YYYY-MM-DD — плановая дата расчёта
    total_amount: int = Field(ge=0, default=0)   # копейки
    comment:      str | None = None
    shipment_ids: list[str] = []


class InvoiceUpdate(BaseModel):
    """Правка реквизитов черновика. Применяются только переданные поля."""
    client_id:    str | None = None
    client_name:  str | None = None
    due_date:     str | None = None
    total_amount: int | None = Field(default=None, ge=0)
    comment:      str | None = None


class InvoiceAttachShipments(BaseModel):
    shipment_ids: list[str] = []


class InvoiceShipmentItem(BaseModel):
    shipment_doc_id: str
    doc_number:      str
    cargo_type:      str
    status:          str
    status_label:    str
    ship_date:       str | None = None
    destination:     str | None = None


class InvoicePaymentItem(BaseModel):
    id:               str
    amount:           int                    # копейки
    paid_on:          str | None = None
    comment:          str | None = None
    created_at:       str
    created_by:       str | None = None
    created_by_email: str | None = None


class InvoiceFileItem(BaseModel):
    id:         str
    filename:   str
    url:        str
    mime_type:  str | None = None
    created_at: str


class InvoiceOpItem(BaseModel):
    id:               str
    op_type:          str
    comment:          str | None = None
    created_at:       str
    created_by:       str | None = None
    created_by_email: str | None = None


class InvoiceDetailResponse(BaseModel):
    id:           str
    doc_number:   str
    client_id:    str | None
    client_name:  str | None
    status:       str
    status_label: str
    total_amount: int
    paid_amount:  int
    due_date:     str | None
    overdue:      bool = False
    due_reached:  bool = False
    comment:      str | None
    created_at:   str
    created_by:   str | None
    updated_at:   str | None
    shipments:    list[InvoiceShipmentItem]
    payments:     list[InvoicePaymentItem]
    files:        list[InvoiceFileItem]
    ops:          list[InvoiceOpItem]


class InvoiceListItem(BaseModel):
    id:             str
    doc_number:     str
    client_id:      str | None
    client_name:    str | None
    status:         str
    status_label:   str
    total_amount:   int
    paid_amount:    int
    due_date:       str | None
    overdue:        bool
    shipment_count: int
    created_at:     str


class InvoiceListResponse(BaseModel):
    items: list[InvoiceListItem]
    total: int
    page:  int
    limit: int


class UninvoicedShipmentItem(BaseModel):
    id:           str           # shipment_docs.id
    doc_number:   str
    cargo_type:   str
    client_id:    str | None
    client_name:  str | None
    destination:  str | None
    ship_date:    str | None
    sku_count:    int
    total_qty:    int
    created_at:   str


class UninvoicedShipmentsResponse(BaseModel):
    items: list[UninvoicedShipmentItem]
    total: int
    page:  int
    limit: int


class InvoicePaymentCreate(BaseModel):
    amount:  int = Field(ge=1)         # копейки
    paid_on: str | None = None         # YYYY-MM-DD
    comment: str | None = None


class InvoiceDueDateUpdate(BaseModel):
    due_date: str
    reason:   str | None = None        # причина переноса (для аудита спора), необязательна


class InvoiceAmountUpdate(BaseModel):
    """Корректировка суммы выставленного счёта (спор клиента и т.п.)."""
    total_amount: int = Field(ge=1)    # копейки
    reason:       str                  # обязательная причина корректировки


class InvoiceAlertsResponse(BaseModel):
    due_count:          int            # активные счета с due_date <= сегодня
    overdue_count:      int            # из них просроченные (due_date < сегодня)
    active_count:       int = 0        # всего активных счетов (выставлен + частично)
    active_outstanding: int = 0        # остаток к оплате по активным, копейки
