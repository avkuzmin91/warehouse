from __future__ import annotations

from pydantic import BaseModel, Field


class MessageResponse(BaseModel):
    message: str


# ── Ставка (effective-dated) ─────────────────────────────────────────────────────

class RecurringRateEntry(BaseModel):
    id:             str
    amount_kop:     int
    effective_from: str
    note:           str | None = None
    created_at:     str
    created_by:     str | None = None


class SetRecurringRateRequest(BaseModel):
    amount_kop:     int = Field(ge=1)
    effective_from: str | None = None
    note:           str | None = None


# ── Шаблон регулярного расхода ────────────────────────────────────────────────────

class RecurringTemplateCreate(BaseModel):
    name:              str = Field(min_length=1)
    category_id:       str | None = None
    payment_source_id: str | None = None
    supplier:          str | None = None
    frequency:         str                       # daily | monthly
    month_day:         int | None = Field(default=None, ge=1, le=28)
    start_date:        str | None = None         # default: сегодня
    end_date:          str | None = None
    is_active:         bool = True
    amount_kop:        int | None = Field(default=None, ge=1)  # стартовая ставка (опц.)


class RecurringTemplateUpdate(BaseModel):
    name:              str | None = Field(default=None, min_length=1)
    category_id:       str | None = None
    payment_source_id: str | None = None
    supplier:          str | None = None
    frequency:         str | None = None
    month_day:         int | None = Field(default=None, ge=1, le=28)
    start_date:        str | None = None
    end_date:          str | None = None
    is_active:         bool | None = None


class RecurringTemplateItem(BaseModel):
    id:                  str
    name:                str
    category_id:         str | None = None
    category_name:       str | None = None
    payment_source_id:   str | None = None
    payment_source_name: str | None = None
    supplier:            str | None = None
    frequency:           str
    frequency_label:     str = ""
    month_day:           int | None = None
    start_date:          str
    end_date:            str | None = None
    is_active:           bool
    current_amount_kop:  int | None = None        # действующая на сегодня ставка
    created_at:          str


class RecurringTemplateDetail(RecurringTemplateItem):
    rates: list[RecurringRateEntry]


class RecurringTemplateListResponse(BaseModel):
    items: list[RecurringTemplateItem]
    total: int
    page:  int
    limit: int


# ── Массовая оплата по шаблону (FIFO) ────────────────────────────────────────────

class RecurringOutstandingItem(BaseModel):
    template_id:        str
    template_name:      str
    outstanding_amount: int
    count:              int


class RecurringPayRequest(BaseModel):
    template_id:       str
    amount:            int = Field(ge=1)
    payment_source_id: str
    paid_on:           str | None = None


class RecurringPayResponse(BaseModel):
    allocated_amount:     int
    affected_count:       int
    fully_paid_count:     int
    partially_paid_count: int


class AccrualRunResponse(BaseModel):
    created:  int
    on_date:  str
