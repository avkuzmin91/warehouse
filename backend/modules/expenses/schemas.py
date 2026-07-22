from __future__ import annotations

from pydantic import BaseModel, Field


# ── Справочники (категории, источники оплаты) ───────────────────────────────────

class ExpenseDictItem(BaseModel):
    id:   str
    name: str


class ExpenseDictCreate(BaseModel):
    name: str


class ExpenseDictUpdate(BaseModel):
    name: str


# ── Расход ──────────────────────────────────────────────────────────────────────

class ExpenseCreate(BaseModel):
    spent_on:          str                      # YYYY-MM-DD — дата начисления
    category_id:       str | None = None        # обязательна для хозрасхода
    name:              str
    quantity:          float = Field(default=1, gt=0)
    unit:              str | None = None         # обязателен для хозрасхода
    amount:            int = Field(ge=1)        # копейки
    payment_source_id: str | None = None         # «с чьей карты» — обязателен при оплате
    supplier:          str | None = None
    comment:           str | None = None
    kind:              str = "manual"            # manual | logistics | rent | salary
    payment_status:    str | None = None         # default: awaiting для logistics, иначе paid
    paid_on:           str | None = None         # дата оплаты (для paid)
    period_start:      str | None = None         # период: аренда — месяц, ЗП — неделя
    period_end:        str | None = None
    source_kind:       str | None = None         # trip | employee
    source_id:         str | None = None


class ExpensePayRequest(BaseModel):
    """Оплата расхода: дата, с чьей карты и опционально сумма (копейки).
    amount не задан → гасится весь остаток (полная оплата)."""
    paid_on:           str | None = None
    payment_source_id: str | None = None
    amount:            int | None = Field(default=None, ge=1)


class ExpenseCarrierPayRequest(BaseModel):
    """Массовая оплата перевозчику: распределение суммы по его логистическим расходам
    от ранних к поздним."""
    carrier_id:        str
    amount:            int = Field(ge=1)
    payment_source_id: str
    paid_on:           str | None = None


class ExpenseCarrierPayResponse(BaseModel):
    allocated_amount:     int
    affected_count:       int
    fully_paid_count:     int
    partially_paid_count: int


class CarrierOutstandingItem(BaseModel):
    carrier_id:         str
    carrier_name:       str
    outstanding_amount: int
    count:              int


class ExpenseUpdate(BaseModel):
    """Полная правка строки расхода — модалка отправляет все поля сразу.
    Категория/ед.изм./источник обязательны только для хозрасхода (kind=manual)."""
    spent_on:          str
    category_id:       str | None = None
    name:              str
    quantity:          float = Field(default=1, gt=0)
    unit:              str | None = None
    amount:            int = Field(ge=1)
    payment_source_id: str | None = None
    supplier:          str | None = None
    comment:           str | None = None
    period_start:      str | None = None
    period_end:        str | None = None


class ExpenseFileItem(BaseModel):
    id:         str
    filename:   str
    url:        str
    mime_type:  str | None = None
    created_at: str


class ExpenseOpItem(BaseModel):
    id:               str
    op_type:          str
    op_label:         str
    comment:          str | None = None
    created_at:       str
    created_by:       str | None = None
    created_by_email: str | None = None


class ExpensePaymentItem(BaseModel):
    id:                  str
    amount:              int
    paid_on:             str | None = None
    payment_source_id:   str | None = None
    payment_source_name: str | None = None
    comment:             str | None = None
    created_at:          str
    created_by_email:    str | None = None


class ExpenseListItem(BaseModel):
    id:                   str
    exp_number:           str
    spent_on:             str
    category_id:          str | None = None
    category_name:        str | None = None
    name:                 str
    quantity:             float
    unit:                 str | None = None
    amount:               int
    paid_amount:          int = 0
    carrier_id:           str | None = None
    carrier_name:         str | None = None
    payment_source_id:    str | None = None
    payment_source_name:  str | None = None
    supplier:             str | None = None
    comment:              str | None = None
    kind:                 str = "manual"
    kind_label:           str = ""
    payment_status:       str = "paid"
    payment_status_label: str = ""
    paid_on:              str | None = None
    period_start:         str | None = None
    period_end:           str | None = None
    source_kind:          str | None = None
    source_id:            str | None = None
    salary_subtype:       str | None = None
    salary_subtype_label: str | None = None
    file_count:           int = 0
    created_at:           str
    created_by_email:     str | None = None


class ExpenseDetailResponse(ExpenseListItem):
    updated_at:         str | None = None
    source_trip_number: str | None = None
    payments:           list[ExpensePaymentItem]
    files:              list[ExpenseFileItem]
    ops:                list[ExpenseOpItem]


class ExpenseListResponse(BaseModel):
    items: list[ExpenseListItem]
    total: int
    page:  int
    limit: int


class ExpenseSummaryBreakdown(BaseModel):
    id:     str | None = None
    name:   str
    amount: int
    count:  int


class ExpenseSummaryResponse(BaseModel):
    total_amount:       int
    total_count:        int
    awaiting_amount:    int = 0
    awaiting_count:     int = 0
    paid_amount:        int = 0
    by_category:        list[ExpenseSummaryBreakdown]
    by_payment_source:  list[ExpenseSummaryBreakdown]


class ExpenseAnalyticsPoint(BaseModel):
    date:   str
    amount: int


class ExpenseAnalyticsKind(BaseModel):
    kind:       str
    kind_label: str
    amount:     int
    count:      int


class ExpenseAnalyticsStatus(BaseModel):
    payment_status: str
    label:          str
    amount:         int
    count:          int


class ExpenseAnalyticsCategory(BaseModel):
    id:     str | None = None
    name:   str
    kind:   str
    series: list[int]


class ExpenseAnalyticsResponse(BaseModel):
    date_from:      str
    date_to:        str
    days:           int
    total_amount:   int
    avg_per_day:    int
    max_day_amount: int
    series:         list[ExpenseAnalyticsPoint]
    categories:     list[ExpenseAnalyticsCategory]
    by_kind:        list[ExpenseAnalyticsKind]
    by_category:    list[ExpenseSummaryBreakdown]
    by_status:      list[ExpenseAnalyticsStatus]


class PayableDayPoint(BaseModel):
    date:            str
    accrued_kop:     int
    paid_kop:        int
    outstanding_kop: int      # долг на конец дня (накопительно)


class PayableAgingBucket(BaseModel):
    key:        str
    label:      str
    count:      int
    amount_kop: int


class PayableKindRow(BaseModel):
    kind:        str
    kind_label:  str
    accrued_kop: int
    paid_kop:    int
    debt_kop:    int


class PayableCounterpartyRow(BaseModel):
    key:         str          # carrier_id либо текст поставщика
    name:        str
    accrued_kop: int
    paid_kop:    int
    debt_kop:    int
    oldest_days: int          # возраст самого старого непогашенного обязательства
    debt_count:  int


class PayablesAnalyticsResponse(BaseModel):
    date_from:        str
    date_to:          str
    accrued_kop:      int
    accrued_count:    int
    paid_kop:         int
    payment_count:    int
    opening_debt_kop: int
    debt_kop:         int
    debt_count:       int
    avg_days_to_pay:  float
    series:           list[PayableDayPoint]
    aging:            list[PayableAgingBucket]
    by_kind:          list[PayableKindRow]
    counterparties:   list[PayableCounterpartyRow]
    counterparties_total: int


class MessageResponse(BaseModel):
    message: str


class AccrualRunResponse(BaseModel):
    created:  int
    on_date:  str
