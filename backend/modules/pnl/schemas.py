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
    trip_id:       str
    trip_number:   str
    direction:     str
    cargo_type:    str | None = None
    status:        str
    status_label:  str
    day:           str | None = None    # фактический день рейса (прибытие)
    carrier_name:  str | None = None
    client_names:  list[str] = []
    income_kop:    int                  # логистика клиента + палеты
    cost_kop:      int                  # фактическая себестоимость рейса
    margin_kop:    int                  # income − cost; <0 — убыток
    margin_pct:    float | None = None   # None — дохода нет


class TripProfitabilityResponse(BaseModel):
    date_from:    str
    date_to:      str
    income_total: int
    cost_total:   int
    margin_total: int
    items:        list[TripProfitItem]
