from __future__ import annotations

from pydantic import BaseModel, Field


# ── Сотрудники ────────────────────────────────────────────────────────────────

class EmployeeCreate(BaseModel):
    full_name:          str
    position_id:        str | None = None             # должность из справочника positions
    hired_on:           str | None = None             # YYYY-MM-DD
    user_id:            str | None = None             # связь с учёткой (только admin)
    supervisor_user_id: str | None = None             # руководитель (только admin)
    rate_kopecks:       int | None = Field(default=None, ge=0)   # стартовая ставка, копейки/час
    effective_from:     str | None = None             # дата действия стартовой ставки


class EmployeeUpdate(BaseModel):
    full_name:          str | None = None
    position_id:        str | None = None
    hired_on:           str | None = None
    user_id:            str | None = None             # только admin
    supervisor_user_id: str | None = None             # только admin


class RateCreate(BaseModel):
    rate_kopecks:   int = Field(ge=0)
    effective_from: str                               # YYYY-MM-DD
    note:           str | None = None


class EmployeeListItem(BaseModel):
    id:                 str
    full_name:          str
    position:           str | None = None
    position_id:        str | None = None
    supervisor_user_id: str | None = None
    supervisor_name:    str | None = None             # email руководителя (для отображения)
    status:             str
    status_label:       str
    last_shift:         str | None = None
    rate_kopecks:       int | None = None             # только для менеджера


class EmployeeListResponse(BaseModel):
    items: list[EmployeeListItem]
    total: int


class EmployeeLookupItem(BaseModel):
    id:       str
    name:     str
    position: str | None = None


class RateHistoryItem(BaseModel):
    rate_kopecks:   int
    effective_from: str
    note:           str | None = None
    current:        bool = False


class PayHistoryItem(BaseModel):
    id:             str
    kind:           str
    kind_label:     str
    amount_kopecks: int
    paid_on:        str | None = None
    period_start:   str | None = None
    period_end:     str | None = None
    comment:        str | None = None
    created_at:     str


class EmployeeWeekSummary(BaseModel):
    hours:       float
    worked_days: int
    absent:      int
    earned:      int | None = None
    advances:    int | None = None
    to_pay:      int | None = None
    overpaid:    int | None = None


class EmployeeDetailResponse(BaseModel):
    id:                 str
    full_name:          str
    position:           str | None = None
    position_id:        str | None = None
    user_id:            str | None = None
    user_email:         str | None = None
    supervisor_user_id: str | None = None
    supervisor_name:    str | None = None
    status:             str
    status_label:       str
    hired_on:           str | None = None
    rate_kopecks:       int | None = None             # текущая ставка (менеджер)
    with_money:    bool
    week_start:    str
    week_end:      str
    week_label:    str
    this_week:     EmployeeWeekSummary
    rate_history:  list[RateHistoryItem] = []         # менеджер
    pay_history:   list[PayHistoryItem] = []          # менеджер


# ── Табель (сетка недели) ─────────────────────────────────────────────────────

class WeekDayMeta(BaseModel):
    date:     str
    dow:      str
    dom:      str
    date_ru:  str
    weekend:  bool
    is_today: bool


class WeekCell(BaseModel):
    date:          str
    status:        str
    planned_start: str | None = None
    planned_end:   str | None = None
    actual_start:  str | None = None
    actual_end:    str | None = None
    hours:         float
    note:          str | None = None


class WeekRow(BaseModel):
    employee_id: str
    full_name:   str
    position:    str | None = None
    cells:       list[WeekCell]
    hours:       float
    worked_days: int
    absent:      int
    earned:      int | None = None


class WeekTotals(BaseModel):
    hours:     float
    earned:    int | None = None
    absent:    int
    per_day:   list[float]
    employees: int


class WeekResponse(BaseModel):
    week_start: str
    week_end:   str
    week_label: str
    today:      str
    with_money: bool
    days:       list[WeekDayMeta]
    rows:       list[WeekRow]
    totals:     WeekTotals


# ── Карточка дня (запись) ─────────────────────────────────────────────────────

class EntryOpItem(BaseModel):
    id:               str
    op_type:          str
    comment:          str | None = None
    created_at:       str
    created_by:       str | None = None
    created_by_email: str | None = None


class EntryDetailResponse(BaseModel):
    employee_id:   str
    employee_name: str
    work_date:     str
    planned_start: str | None = None
    planned_end:   str | None = None
    actual_start:  str | None = None
    actual_end:    str | None = None
    is_absent:     bool = False
    status:        str
    hours:         float
    note:          str | None = None
    ops:           list[EntryOpItem] = []


class EntryUpsert(BaseModel):
    employee_id:   str
    work_date:     str                                # YYYY-MM-DD
    planned_start: str | None = None
    planned_end:   str | None = None
    actual_start:  str | None = None
    actual_end:    str | None = None
    is_absent:     bool = False
    note:          str | None = None


class BulkPlanRequest(BaseModel):
    work_date:     str
    employee_ids:  list[str] = []
    planned_start: str
    planned_end:   str


class WeekParam(BaseModel):
    week: str | None = None                           # суббота расчётной недели


# ── Выплаты / расчёт ──────────────────────────────────────────────────────────

class PayrollRow(BaseModel):
    employee_id:  str
    full_name:    str
    position:     str | None = None
    rate_kopecks: int | None = None
    hours:        float
    earned:       int
    advances:     int
    to_pay:       int
    overpaid:     int
    settled:      bool


class PayrollTotals(BaseModel):
    earned:    int
    advances:  int
    to_pay:    int
    employees: int
    left:      int


class PayrollResponse(BaseModel):
    week_start: str
    week_end:   str
    week_label: str
    rows:       list[PayrollRow]
    totals:     PayrollTotals


class PaymentCreate(BaseModel):
    employee_id:    str
    amount_kopecks: int = Field(ge=1)
    kind:           str                               # settlement | advance
    paid_on:        str | None = None
    period_start:   str                               # суббота недели
    period_end:     str                               # пятница недели
    comment:        str | None = None


class SettleAllRequest(BaseModel):
    week: str | None = None
