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
    """Перевод расхода в «Оплачено»: дата и опционально с чьей карты."""
    paid_on:           str | None = None
    payment_source_id: str | None = None


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
    file_count:           int = 0
    created_at:           str
    created_by_email:     str | None = None


class ExpenseDetailResponse(ExpenseListItem):
    updated_at: str | None = None
    files:      list[ExpenseFileItem]
    ops:        list[ExpenseOpItem]


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
    paid_amount:        int = 0
    by_category:        list[ExpenseSummaryBreakdown]
    by_payment_source:  list[ExpenseSummaryBreakdown]


class MessageResponse(BaseModel):
    message: str


class AccrualRunResponse(BaseModel):
    created:  int
    on_date:  str
