import { request } from './http'

// --- Types --- (подмножество frontend/src/api/dashboardApi.ts)

export type DashboardMetric = {
  plan: number
  fact: number
}

export type DashboardTodayStats = {
  arrivals: DashboardMetric
  packed: DashboardMetric
  shipped: DashboardMetric
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
