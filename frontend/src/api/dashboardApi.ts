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

// --- API functions ---

export function getDashboardToday(signal?: AbortSignal) {
  return request<DashboardTodayResponse>('/dashboard/today', { signal })
}
