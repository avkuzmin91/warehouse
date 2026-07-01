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
  margin_pct: number
  income_series: number[]
  expense_series: number[]
  net_cumulative: number[]
  income_sources: PnlSeries[]
  expense_categories: PnlSeries[]
}

export type PnlParams = { date_from: string; date_to: string; client_id?: string }

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
  carrier_name: string | null
  income_kop: number
  cost_kop: number
  margin_kop: number
  margin_pct: number
}

export type TripProfitability = {
  date_from: string
  date_to: string
  income_total: number
  cost_total: number
  margin_total: number
  items: TripProfitItem[]
}

// --- API functions ---

export function getPnl(params: PnlParams, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<Pnl>(`/pnl?${sp.toString()}`, { signal })
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

export function getTripProfitability(params: { date_from: string; date_to: string }, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  return request<TripProfitability>(`/pnl/trips?${sp.toString()}`, { signal })
}
