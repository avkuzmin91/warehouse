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
    margin_pct:         float           # net / income · 100 (0, если дохода нет)
    income_series:      list[int]       # доход по дням
    expense_series:     list[int]       # расход по дням
    net_cumulative:     list[int]       # нарастающий итог прибыли по дням
    income_sources:     list[PnlSeries]
    expense_categories: list[PnlSeries]


class TripProfitItem(BaseModel):
    trip_id:       str
    trip_number:   str
    direction:     str
    cargo_type:    str | None = None
    status:        str
    status_label:  str
    day:           str | None = None    # фактический день рейса (прибытие)
    carrier_name:  str | None = None
    income_kop:    int                  # логистика клиента + палеты
    cost_kop:      int                  # фактическая себестоимость рейса
    margin_kop:    int                  # income − cost; <0 — убыток
    margin_pct:    float


class TripProfitabilityResponse(BaseModel):
    date_from:    str
    date_to:      str
    income_total: int
    cost_total:   int
    margin_total: int
    items:        list[TripProfitItem]
