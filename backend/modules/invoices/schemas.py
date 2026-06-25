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
    sku_count:       int = 0
    total_qty:       int = 0
    logistics_cost_kop: int = 0


class InvoiceReceiptItem(BaseModel):
    receipt_doc_id:  str
    doc_number:      str
    status:          str
    status_label:    str
    arrival_date:    str | None = None
    supplier_name:   str | None = None
    sku_count:       int = 0
    total_qty:       int = 0
    logistics_cost_kop: int = 0


class InvoiceAttachReceipts(BaseModel):
    receipt_ids: list[str] = []


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
    dispatch_logistics_kop: int = 0
    receipt_logistics_kop:  int = 0
    shipments:    list[InvoiceShipmentItem]
    receipts:     list[InvoiceReceiptItem] = []
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
    receipt_count:  int = 0
    created_at:     str


class InvoiceListResponse(BaseModel):
    items: list[InvoiceListItem]
    total: int
    page:  int
    limit: int


class ProductPreviewItem(BaseModel):
    name: str
    qty:  int


class UninvoicedShipmentItem(BaseModel):
    id:               str           # shipment_docs.id
    doc_number:       str
    cargo_type:       str
    client_id:        str | None
    client_name:      str | None
    destination:      str | None
    ship_date:        str | None
    sku_count:        int
    total_qty:        int
    products_preview: list[ProductPreviewItem] = []   # топ-товары для свёрнутой строки
    created_at:       str


class UninvoicedShipmentsResponse(BaseModel):
    items: list[UninvoicedShipmentItem]
    total: int
    page:  int
    limit: int


class UninvoicedReceiptItem(BaseModel):
    id:               str           # receipt_docs.id
    doc_number:       str
    client_id:        str | None
    client_name:      str | None
    supplier_name:    str | None
    arrival_date:     str | None
    logistics_cost_kop: int = 0
    sku_count:        int
    total_qty:        int
    products_preview: list[ProductPreviewItem] = []
    created_at:       str


class UninvoicedReceiptsResponse(BaseModel):
    items: list[UninvoicedReceiptItem]
    total: int
    page:  int
    limit: int


class ShipmentContentsProduct(BaseModel):
    product_id: str
    name:       str
    sku:        str | None = None
    qty:        int


class ShipmentContentsResponse(BaseModel):
    """Сводный состав по набору отгрузок (roll-up при выборе в счёт)."""
    products:  list[ShipmentContentsProduct] = []
    total_qty: int = 0
    sku_count: int = 0
    suggested_amount_kop: int = 0          # Σ qty × тариф на дату отгрузки (товары)
    logistics_amount_kop: int = 0          # Σ logistics_cost отгрузок (логистика)
    has_missing_price:    bool = False     # по части позиций тариф не заведён


class ReceiptContentsResponse(BaseModel):
    """Сводный состав по набору поступлений (roll-up при выборе в счёт)."""
    products:  list[ShipmentContentsProduct] = []
    total_qty: int = 0
    sku_count: int = 0
    logistics_amount_kop: int = 0          # Σ logistics_cost поступлений (логистика)


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
