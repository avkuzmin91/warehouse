import { request } from './http'

// --- Types ---

export type PnlSeries = {
  key: string
  label: string
  kind: string | null
  amount: number       // копейки за период
  series: number[]     // копейки по дням axis
}

export type Pnl = {
  date_from: string
  date_to: string
  days: number
  axis: string[]
  income_total: number
  expense_total: number
  net_total: number
  margin_pct: number | null
  income_series: number[]
  expense_series: number[]
  net_cumulative: number[]
  income_sources: PnlSeries[]
  expense_categories: PnlSeries[]
}

export type PnlParams = { date_from: string; date_to: string; client_id?: string }

export type MonthlyPnlSeries = {
  key: string
  label: string
  kind: string | null
  amount: number       // копейки за период
  series: number[]     // копейки по месяцам months
}

export type MonthlyPnl = {
  date_from: string
  date_to: string
  months: string[]                          // 'YYYY-MM'
  packed_good: number[]                     // упаковано годного, шт.
  packed_defect: number[]
  packed_total: number[]
  avg_packing_income_kop: (number | null)[] // доход упаковки на 1 шт.; null — не паковали
  income_total: number
  income_series: number[]
  income_sources: MonthlyPnlSeries[]
  expense_total: number
  expense_series: number[]
  expense_categories: MonthlyPnlSeries[]
  net_total: number                         // EBITDA: доход − расход OPEX
  net_series: number[]
  margin_pct: number | null
  margin_series: (number | null)[]
}

export type IncomeSourceSeries = {
  key: string
  name: string
  kind: string | null
  series: number[]     // копейки по дням
}
export type IncomeClientBreakdown = { id: string | null; name: string; amount: number }
export type IncomeAnalyticsPoint = { date: string; amount: number }
export type IncomeAnalytics = {
  date_from: string
  date_to: string
  days: number
  total_amount: number
  avg_per_day: number
  max_day_amount: number
  series: IncomeAnalyticsPoint[]
  sources: IncomeSourceSeries[]
  by_client: IncomeClientBreakdown[]
}

export type PnlDayItem = {
  type: string             // doc | packing | expense | employee | computed
  label: string
  amount: number           // копейки
  ref_id: string | null    // документ/рейс/сотрудник для ссылки
  ref_kind: string | null  // dispatch | receipt | trip | expense | employee
  note: string | null
}
export type PnlDaySource = {
  key: string
  label: string
  kind: string | null
  amount: number
  items: PnlDayItem[]
}
export type PnlDay = {
  date: string
  income_total: number
  expense_total: number
  net_total: number
  income_sources: PnlDaySource[]
  expense_categories: PnlDaySource[]
}

export type TripProfitItem = {
  trip_id: string
  trip_number: string
  direction: string
  cargo_type: string | null
  status: string
  status_label: string
  day: string | null
  carrier_id: string | null
  carrier_name: string | null
  vehicle_type_id: string | null
  vehicle_type_name: string | null
  load_factor: string | null       // full | partial
  client_names: string[]
  income_kop: number
  cost_kop: number
  waiting_kop: number
  waiting_minutes: number
  spent_kop: number                // cost + waiting — сумма расхода рейса в реестре
  margin_kop: number
  margin_pct: number | null
}

export type TripProfitability = {
  date_from: string
  date_to: string
  income_total: number
  cost_total: number
  margin_total: number
  items: TripProfitItem[]
}

export type LogisticsGroupRow = {
  id: string | null                // null — «Не указан»
  name: string
  trips: number
  trips_inbound: number
  trips_outbound: number
  income_kop: number
  spent_kop: number
  margin_kop: number
  margin_pct: number | null
  waiting_kop: number
  waiting_minutes: number
  trips_no_income: number
}

export type LogisticsDayPoint = {
  date: string
  trips_inbound: number
  trips_outbound: number
  income_kop: number
  spent_kop: number
}

export type LogisticsAnalytics = {
  date_from: string
  date_to: string
  days: number
  trips_total: number
  trips_inbound: number
  trips_outbound: number
  income_total: number
  spent_total: number
  margin_total: number
  margin_pct: number | null
  avg_spent_kop: number
  avg_income_kop: number
  waiting_total_kop: number
  waiting_minutes_total: number
  trips_no_income: number
  trips_full: number
  trips_partial: number
  series: LogisticsDayPoint[]
  by_vehicle: LogisticsGroupRow[]
  by_carrier: LogisticsGroupRow[]
  items: TripProfitItem[]
}

export type LogisticsAnalyticsParams = {
  date_from: string
  date_to: string
  client_id?: string
  direction?: string
  vehicle_type_id?: string
  carrier_id?: string
}

// --- API functions ---

export function getPnl(params: PnlParams, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<Pnl>(`/pnl?${sp.toString()}`, { signal })
}

export function getPnlMonthly(params: PnlParams, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<MonthlyPnl>(`/pnl/monthly?${sp.toString()}`, { signal })
}

export function getIncomeAnalytics(params: PnlParams, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<IncomeAnalytics>(`/pnl/income?${sp.toString()}`, { signal })
}

export function getPnlDay(
  params: { date: string; date_from: string; date_to: string; client_id?: string },
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  sp.set('date', params.date)
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<PnlDay>(`/pnl/day?${sp.toString()}`, { signal })
}

export function getLogisticsAnalytics(params: LogisticsAnalyticsParams, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.direction) sp.set('direction', params.direction)
  if (params.vehicle_type_id) sp.set('vehicle_type_id', params.vehicle_type_id)
  if (params.carrier_id) sp.set('carrier_id', params.carrier_id)
  return request<LogisticsAnalytics>(`/pnl/logistics?${sp.toString()}`, { signal })
}

export function getTripProfitability(
  params: { date_from: string; date_to: string; client_id?: string },
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<TripProfitability>(`/pnl/trips?${sp.toString()}`, { signal })
}
