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

export function getTripProfitability(params: { date_from: string; date_to: string }, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  return request<TripProfitability>(`/pnl/trips?${sp.toString()}`, { signal })
}
