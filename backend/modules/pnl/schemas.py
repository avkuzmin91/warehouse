from __future__ import annotations

from pydantic import BaseModel


class PnlSeries(BaseModel):
    key:    str
    label:  str
    kind:   str | None = None
    amount: int            # копейки за период
    series: list[int]      # копейки по дням axis


class PnlResponse(BaseModel):
    date_from:          str
    date_to:            str
    days:               int
    axis:               list[str]       # даты периода (ось X)
    income_total:       int
    expense_total:      int
    net_total:          int             # income − expense; <0 — убыток
    margin_pct:         float | None = None   # net / income · 100; None — дохода нет
    income_series:      list[int]       # доход по дням
    expense_series:     list[int]       # расход по дням
    net_cumulative:     list[int]       # нарастающий итог прибыли по дням
    income_sources:     list[PnlSeries]
    expense_categories: list[PnlSeries]


class MonthlyPnlSeries(BaseModel):
    key:    str
    label:  str
    kind:   str | None = None
    amount: int            # копейки за период
    series: list[int]      # копейки по месяцам months


class MonthlyPnlResponse(BaseModel):
    date_from:              str
    date_to:                str
    months:                 list[str]            # 'YYYY-MM' (ось колонок)
    packed_good:            list[int]            # упаковано годного, шт. по месяцам
    packed_defect:          list[int]            # упаковано брака, шт. по месяцам
    packed_total:           list[int]
    avg_packing_income_kop: list[int | None]     # доход упаковки на 1 шт.; None — не паковали
    income_total:           int
    income_series:          list[int]
    income_sources:         list[MonthlyPnlSeries]
    expense_total:          int
    expense_series:         list[int]
    expense_categories:     list[MonthlyPnlSeries]
    net_total:              int                  # EBITDA: доход − расход OPEX
    net_series:             list[int]
    margin_pct:             float | None = None
    margin_series:          list[float | None]


class IncomeSourceSeries(BaseModel):
    key:    str
    name:   str
    kind:   str | None = None
    series: list[int]      # копейки по дням axis


class IncomeClientBreakdown(BaseModel):
    id:     str | None = None
    name:   str
    amount: int            # копейки за период


class IncomeAnalyticsPoint(BaseModel):
    date:   str
    amount: int            # копейки за день


class IncomeAnalyticsResponse(BaseModel):
    date_from:      str
    date_to:        str
    days:           int
    total_amount:   int             # доход за период, копейки
    avg_per_day:    int
    max_day_amount: int
    series:         list[IncomeAnalyticsPoint]
    sources:        list[IncomeSourceSeries]
    by_client:      list[IncomeClientBreakdown]


class PnlDayItem(BaseModel):
    type:     str                  # doc | packing | expense | employee | computed
    label:    str
    amount:   int                  # копейки
    ref_id:   str | None = None    # id первоисточника для ссылки (документ/рейс/сотрудник)
    ref_kind: str | None = None    # dispatch | receipt | trip | expense | employee
    note:     str | None = None    # пояснение (кол-во шт., доля аренды, защита окладов)


class PnlDaySource(BaseModel):
    key:    str
    label:  str
    kind:   str | None = None
    amount: int                    # копейки за день
    items:  list[PnlDayItem]


class PnlDayResponse(BaseModel):
    date:               str
    income_total:       int
    expense_total:      int
    net_total:          int
    income_sources:     list[PnlDaySource]
    expense_categories: list[PnlDaySource]


class TripProfitItem(BaseModel):
    trip_id:           str
    trip_number:       str
    direction:         str
    cargo_type:        str | None = None
    status:            str
    status_label:      str
    day:               str | None = None    # фактический день рейса (прибытие)
    carrier_id:        str | None = None
    carrier_name:      str | None = None
    vehicle_type_id:   str | None = None
    vehicle_type_name: str | None = None
    load_factor:       str | None = None    # full | partial
    income_kop:        int                  # логистика клиента + палеты
    cost_kop:          int                  # фактическая себестоимость рейса
    waiting_kop:       int = 0              # стоимость простоя
    waiting_minutes:   int = 0
    spent_kop:         int = 0              # cost + waiting — сумма расхода рейса в реестре
    margin_kop:        int                  # income − cost; <0 — убыток
    margin_pct:        float | None = None   # None — дохода нет
    client_names:      list[str] = []


class TripProfitabilityResponse(BaseModel):
    date_from:    str
    date_to:      str
    income_total: int
    cost_total:   int
    margin_total: int
    items:        list[TripProfitItem]


class LogisticsGroupRow(BaseModel):
    id:              str | None = None   # None — «Не указан» (кузов/перевозчик не заведён)
    name:            str
    trips:           int
    trips_inbound:   int
    trips_outbound:  int
    income_kop:      int
    spent_kop:       int                 # себестоимость + простой
    margin_kop:      int
    margin_pct:      float | None = None
    waiting_kop:     int
    waiting_minutes: int
    trips_no_income: int                 # рейсы без выставленной клиенту логистики


class LogisticsDayPoint(BaseModel):
    date:           str
    trips_inbound:  int
    trips_outbound: int
    income_kop:     int
    spent_kop:      int


class LogisticsAnalyticsResponse(BaseModel):
    date_from:            str
    date_to:              str
    days:                 int
    trips_total:          int
    trips_inbound:        int
    trips_outbound:       int
    income_total:         int
    spent_total:          int
    margin_total:         int
    margin_pct:           float | None = None
    avg_spent_kop:        int
    avg_income_kop:       int
    waiting_total_kop:    int
    waiting_minutes_total: int
    trips_no_income:      int
    trips_full:           int
    trips_partial:        int
    series:               list[LogisticsDayPoint]
    by_vehicle:           list[LogisticsGroupRow]
    by_carrier:           list[LogisticsGroupRow]
    items:                list[TripProfitItem]
