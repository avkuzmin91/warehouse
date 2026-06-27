import { request } from './http'

// --- Types ---
export type CalendarException = {
  id: string
  cal_date: string
  is_working: boolean
  reason: string | null
}

export type CalendarMonth = {
  year: number
  month: number
  working_days: number
  items: CalendarException[]
}

export type SetCalendarDayPayload = {
  cal_date: string
  is_working: boolean
  reason?: string | null
}

// --- API functions ---
export function getProductionCalendar(year: number, month: number, signal?: AbortSignal) {
  const sp = new URLSearchParams({ year: String(year), month: String(month) })
  return request<CalendarMonth>(`/production-calendar?${sp.toString()}`, { signal })
}

export function setCalendarDay(payload: SetCalendarDayPayload) {
  return request<{ message: string }>('/production-calendar', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteCalendarDay(calDate: string) {
  return request<{ message: string }>(`/production-calendar/${calDate}`, { method: 'DELETE' })
}
