import { request } from './http'

// --- Types ---

export type DashboardTodayStats = {
  receipt_docs: number
  accepted: number
  shipped: number
  defects: number
}

export type DashboardTodayResponse = {
  today: DashboardTodayStats
  yesterday: DashboardTodayStats
}

export type OperationalPlanItem = {
  type: 'receipt' | 'shipment'
  id: string
  doc_number: string
  status: string
  date: string | null
  date_kind: 'arrival' | 'ship'
  client_name: string | null
  destination: string | null
  sku_count: number
  total_qty: number
  progress_qty: number | null
  overdue: boolean
  priority: 'overdue' | 'today' | 'active' | 'upcoming' | 'no_date'
  priority_rank: number | null
  exception: string | null
}

export type OperationalPlanResponse = {
  receipts: OperationalPlanItem[]
  shipments: OperationalPlanItem[]
  exceptions: OperationalPlanItem[]
  totals: {
    receipts: number
    shipments: number
    overdue: number
  }
}

// --- API functions ---

export function getDashboardToday(signal?: AbortSignal) {
  return request<DashboardTodayResponse>('/dashboard/today', { signal })
}

export async function getOperationalPlan(
  params: { receipts_limit?: number; shipments_limit?: number } = {},
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  if (params.receipts_limit) sp.set('receipts_limit', String(params.receipts_limit))
  if (params.shipments_limit) sp.set('shipments_limit', String(params.shipments_limit))
  const q = sp.toString()
  return request<OperationalPlanResponse>(`/dashboard/operational-plan${q ? `?${q}` : ''}`, { signal })
}
