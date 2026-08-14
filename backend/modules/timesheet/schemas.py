from __future__ import annotations

from pydantic import BaseModel, Field


# ── Сотрудники ────────────────────────────────────────────────────────────────

class EmployeeCreate(BaseModel):
    full_name:          str
    position_id:        str | None = None             # должность из справочника positions
    hired_on:           str | None = None             # YYYY-MM-DD
    user_id:            str | None = None             # связь с учёткой (только admin)
    rate_kopecks:       int | None = Field(default=None, ge=0)   # стартовая ставка, копейки/час
    effective_from:     str | None = None             # дата действия стартовой ставки
    comp_type:          str | None = None             # hourly | fixed
    fixed_salary_kopecks: int | None = Field(default=None, ge=0)  # оклад для fixed, копейки
    salary_from:        str | None = None             # дата начала оклада (для fixed)


class EmployeeUpdate(BaseModel):
    full_name:          str | None = None
    position_id:        str | None = None
    hired_on:           str | None = None
    user_id:            str | None = None             # только admin
    comp_type:          str | None = None             # hourly | fixed
    fixed_salary_kopecks: int | None = Field(default=None, ge=0)


class RateCreate(BaseModel):
    rate_kopecks:   int = Field(ge=0)
    effective_from: str                               # YYYY-MM-DD
    note:           str | None = None


class SalaryCreate(BaseModel):
    salary_kopecks: int = Field(ge=0)
    effective_from: str                               # YYYY-MM-DD
    note:           str | None = None


class EmployeeListItem(BaseModel):
    id:                 str
    full_name:          str
    position:           str | None = None
    position_id:        str | None = None
    status:             str
    status_label:       str
    last_shift:         str | None = None
    rate_kopecks:       int | None = None             # только для менеджера
    comp_type:          str = "hourly"
    fixed_salary_kopecks: int | None = None           # только для менеджера


class EmployeeListResponse(BaseModel):
    items: list[EmployeeListItem]
    total: int


class EmployeeLookupItem(BaseModel):
    id:       str
    name:     str
    position: str | None = None


class RateHistoryItem(BaseModel):
    id:             str
    rate_kopecks:   int
    effective_from: str
    note:           str | None = None
    current:        bool = False


class SalaryHistoryItem(BaseModel):
    id:             str
    salary_kopecks: int
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
    overtime_hours: float = 0.0
    overtime_pay:   int | None = None                 # доплата за переработку (менеджер)
    earned:      int | None = None
    advances:    int | None = None
    to_pay:      int | None = None
    overpaid:    int | None = None
    settled:     bool = False


class AttendanceDay(BaseModel):
    date:         str
    dom:          int
    weekend:      bool
    status:       str
    hours:        float
    overtime_hours: float = 0.0
    late_minutes: int = 0


class AttendanceStats(BaseModel):
    shifts: int
    noplan: int
    absent: int
    hours:  float
    overtime_hours: float = 0.0


class AttendanceAllTime(BaseModel):
    shifts: int
    noplan: int
    absent: int


class AttendanceBlock(BaseModel):
    range_label: str
    days:        list[AttendanceDay] = []
    stats:       AttendanceStats
    alltime:     AttendanceAllTime


class EmployeeDetailResponse(BaseModel):
    id:                 str
    full_name:          str
    position:           str | None = None
    position_id:        str | None = None
    user_id:            str | None = None
    user_email:         str | None = None
    status:             str
    status_label:       str
    hired_on:           str | None = None
    rate_kopecks:       int | None = None             # текущая ставка (менеджер)
    comp_type:          str = "hourly"
    comp_label:         str = ""
    fixed_salary_kopecks: int | None = None           # оклад (менеджер)
    with_money:    bool
    week_start:    str
    week_end:      str
    week_label:    str
    this_week:     EmployeeWeekSummary
    attendance:    AttendanceBlock
    rate_history:    list[RateHistoryItem] = []       # менеджер (почасовики)
    salary_history:  list[SalaryHistoryItem] = []     # менеджер (окладники)
    pay_history:     list[PayHistoryItem] = []        # менеджер


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
    is_absent:     bool = False
    not_called:    bool = False
    no_lunch:      bool = False
    end_next_day:  bool = False
    hours:         float
    overtime_hours: float = 0.0
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
    overtime_hours: float = 0.0
    overtime_pay:   int | None = None                 # доплата за переработку (менеджер)
    fact_locked: bool = False                         # неделя закрыта расчётом — факт не менять
    archived:    bool = False                          # сотрудник в архиве — строка осталась за историю недели


class WeekTotals(BaseModel):
    hours:     float
    earned:    int | None = None
    absent:    int
    overtime_hours: float = 0.0
    overtime_pay:   int | None = None
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
    not_called:    bool = False
    no_lunch:      bool = False
    end_next_day:  bool = False
    status:        str
    hours:         float
    shift_hours:   float = 0.0                        # время на смене (без вычета обеда)
    base_hours:    float = 0.0                        # оплачиваемые часы до порога переработки
    overtime_tier1_hours: float = 0.0                 # первые часы сверх порога (×1.3)
    overtime_tier2_hours: float = 0.0                 # дальнейшие часы (×1.5)
    rate_kopecks:  int | None = None                  # ставка дня (менеджер)
    earned:        int | None = None                  # заработок за день (менеджер)
    overtime_pay:  int | None = None                  # доплата за переработку (менеджер)
    note:          str | None = None
    fact_locked:   bool = False                       # неделя закрыта расчётом — факт не менять
    ops:           list[EntryOpItem] = []


class EntryUpsert(BaseModel):
    employee_id:   str
    work_date:     str                                # YYYY-MM-DD
    planned_start: str | None = None
    planned_end:   str | None = None
    actual_start:  str | None = None
    actual_end:    str | None = None
    is_absent:     bool = False
    not_called:    bool = False
    no_lunch:      bool = False
    end_next_day:  bool = False
    note:          str | None = None


class BulkPlanRequest(BaseModel):
    work_date:     str
    employee_ids:  list[str] = []
    planned_start: str
    planned_end:   str


class DayFactItem(BaseModel):
    employee_id:  str
    actual_start: str | None = None
    actual_end:   str | None = None
    is_absent:    bool = False
    not_called:   bool = False
    no_lunch:     bool = False
    end_next_day: bool = False
    note:         str | None = None


class DayFactBulkRequest(BaseModel):
    work_date: str                                    # YYYY-MM-DD
    items:     list[DayFactItem] = []


class WeekParam(BaseModel):
    week: str | None = None                           # суббота расчётной недели


class FillFactRequest(BaseModel):
    week:  str | None = None                          # суббота расчётной недели
    force: bool = False                               # переписать факт планом даже на «не вышел» и заполненных днях


# ── Выплаты / расчёт ──────────────────────────────────────────────────────────

class PayrollRow(BaseModel):
    employee_id:  str
    full_name:    str
    position:     str | None = None
    rate_kopecks: int | None = None
    hours:        float
    earned:       int
    overtime_hours: float = 0.0
    overtime_pay:   int = 0
    advances:     int
    to_pay:       int
    overpaid:     int
    settled:      bool
    archived:     bool = False                         # сотрудник в архиве — строка осталась за историю недели


class PayrollTotals(BaseModel):
    earned:    int
    advances:  int
    to_pay:    int
    overtime_hours: float = 0.0
    overtime_pay:   int = 0
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
