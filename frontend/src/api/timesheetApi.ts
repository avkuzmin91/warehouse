import { request } from './http'

// --- Types ---

export type EmployeeStatus = 'active' | 'archived'
export type DayStatus = 'worked' | 'planned' | 'absent' | 'noplan' | 'not_called' | 'off'
export type PayKind = 'settlement' | 'advance'

export type CompType = 'hourly' | 'fixed'

export type EmployeeListItem = {
  id: string
  full_name: string
  position: string | null
  position_id: string | null
  status: EmployeeStatus
  status_label: string
  last_shift: string | null
  rate_kopecks: number | null
  comp_type: CompType
  fixed_salary_kopecks: number | null
}
export type EmployeeListResponse = { items: EmployeeListItem[]; total: number }
export type EmployeeLookupItem = { id: string; name: string; position: string | null }

export type RateHistoryItem = {
  id: string
  rate_kopecks: number
  effective_from: string
  note: string | null
  current: boolean
}
export type SalaryHistoryItem = {
  id: string
  salary_kopecks: number
  effective_from: string
  note: string | null
  current: boolean
}
export type PayHistoryItem = {
  id: string
  kind: PayKind
  kind_label: string
  amount_kopecks: number
  paid_on: string | null
  period_start: string | null
  period_end: string | null
  comment: string | null
  created_at: string
}
export type EmployeeWeekSummary = {
  hours: number
  worked_days: number
  absent: number
  earned: number | null
  advances: number | null
  to_pay: number | null
  overpaid: number | null
}
export type AttendanceStatus = DayStatus | 'prehire' | 'future'
export type AttendanceDay = {
  date: string
  dom: number
  weekend: boolean
  status: AttendanceStatus
  hours: number
  late_minutes: number
}
export type AttendanceStats = { shifts: number; noplan: number; absent: number; hours: number }
export type AttendanceAllTime = { shifts: number; noplan: number; absent: number }
export type AttendanceBlock = {
  range_label: string
  days: AttendanceDay[]
  stats: AttendanceStats
  alltime: AttendanceAllTime
}

export type EmployeeDetail = {
  id: string
  full_name: string
  position: string | null
  position_id: string | null
  user_id: string | null
  user_email: string | null
  status: EmployeeStatus
  status_label: string
  hired_on: string | null
  rate_kopecks: number | null
  comp_type: CompType
  comp_label: string
  fixed_salary_kopecks: number | null
  with_money: boolean
  week_start: string
  week_end: string
  week_label: string
  this_week: EmployeeWeekSummary
  attendance: AttendanceBlock
  rate_history: RateHistoryItem[]
  salary_history: SalaryHistoryItem[]
  pay_history: PayHistoryItem[]
}

export type WeekDayMeta = {
  date: string
  dow: string
  dom: string
  date_ru: string
  weekend: boolean
  is_today: boolean
}
export type WeekCell = {
  date: string
  status: DayStatus
  planned_start: string | null
  planned_end: string | null
  actual_start: string | null
  actual_end: string | null
  is_absent: boolean
  not_called: boolean
  no_lunch: boolean
  end_next_day: boolean
  hours: number
  note: string | null
}
export type WeekRow = {
  employee_id: string
  full_name: string
  position: string | null
  cells: WeekCell[]
  hours: number
  worked_days: number
  absent: number
  earned: number | null
  fact_locked: boolean
  archived: boolean
}
export type WeekTotals = {
  hours: number
  earned: number | null
  absent: number
  per_day: number[]
  employees: number
}
export type WeekResponse = {
  week_start: string
  week_end: string
  week_label: string
  today: string
  with_money: boolean
  days: WeekDayMeta[]
  rows: WeekRow[]
  totals: WeekTotals
}

export type EntryOpItem = {
  id: string
  op_type: string
  comment: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
}
export type EntryDetail = {
  employee_id: string
  employee_name: string
  work_date: string
  planned_start: string | null
  planned_end: string | null
  actual_start: string | null
  actual_end: string | null
  is_absent: boolean
  not_called: boolean
  no_lunch: boolean
  end_next_day: boolean
  status: DayStatus
  hours: number
  note: string | null
  fact_locked: boolean
  ops: EntryOpItem[]
}
export type EntryUpsertPayload = {
  employee_id: string
  work_date: string
  planned_start?: string | null
  planned_end?: string | null
  actual_start?: string | null
  actual_end?: string | null
  is_absent?: boolean
  not_called?: boolean
  no_lunch?: boolean
  end_next_day?: boolean
  note?: string | null
}

export type DayFactItem = {
  employee_id: string
  actual_start?: string | null
  actual_end?: string | null
  is_absent?: boolean
  not_called?: boolean
  no_lunch?: boolean
  end_next_day?: boolean
  note?: string | null
}

export type PayrollRow = {
  employee_id: string
  full_name: string
  position: string | null
  rate_kopecks: number | null
  hours: number
  earned: number
  advances: number
  to_pay: number
  overpaid: number
  settled: boolean
  archived: boolean
}
export type PayrollTotals = {
  earned: number
  advances: number
  to_pay: number
  employees: number
  left: number
}
export type PayrollResponse = {
  week_start: string
  week_end: string
  week_label: string
  rows: PayrollRow[]
  totals: PayrollTotals
}

export type EmployeeCreatePayload = {
  full_name: string
  position_id?: string | null
  hired_on?: string | null
  user_id?: string | null
  rate_kopecks?: number | null
  effective_from?: string | null
  comp_type?: CompType
  fixed_salary_kopecks?: number | null
  salary_from?: string | null
}
export type EmployeeUpdatePayload = {
  full_name?: string
  position_id?: string | null
  hired_on?: string | null
  user_id?: string | null
  comp_type?: CompType
  fixed_salary_kopecks?: number | null
}
export type PaymentCreatePayload = {
  employee_id: string
  amount_kopecks: number
  kind: PayKind
  paid_on?: string | null
  period_start: string
  period_end: string
  comment?: string | null
}

// --- API functions ---

export function getEmployees(
  params: { status?: string; search?: string } = {},
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<EmployeeListResponse>(`/employees${q ? `?${q}` : ''}`, { signal })
}

export function getEmployeesLookup(signal?: AbortSignal) {
  return request<EmployeeLookupItem[]>('/employees/lookup', { signal })
}

export function getEmployee(id: string, signal?: AbortSignal) {
  return request<EmployeeDetail>(`/employees/${id}`, { signal })
}

export function createEmployee(payload: EmployeeCreatePayload) {
  return request<{ message: string }>('/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateEmployee(id: string, payload: EmployeeUpdatePayload) {
  return request<{ message: string }>(`/employees/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function archiveEmployee(id: string) {
  return request<{ message: string }>(`/employees/${id}/archive`, { method: 'POST' })
}

export function restoreEmployee(id: string) {
  return request<{ message: string }>(`/employees/${id}/restore`, { method: 'POST' })
}

export function addEmployeeRate(
  id: string,
  payload: { rate_kopecks: number; effective_from: string; note?: string | null },
) {
  return request<{ message: string }>(`/employees/${id}/rates`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteEmployeeRate(id: string, rateId: string) {
  return request<{ message: string }>(`/employees/${id}/rates/${rateId}`, { method: 'DELETE' })
}

export function addEmployeeSalary(
  id: string,
  payload: { salary_kopecks: number; effective_from: string; note?: string | null },
) {
  return request<{ message: string }>(`/employees/${id}/salaries`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteEmployeeSalary(id: string, salaryId: string) {
  return request<{ message: string }>(`/employees/${id}/salaries/${salaryId}`, { method: 'DELETE' })
}

export function getTimesheetWeek(week: string | undefined, signal?: AbortSignal) {
  const q = week ? `?week=${encodeURIComponent(week)}` : ''
  return request<WeekResponse>(`/timesheet/week${q}`, { signal })
}

export function getEntry(employeeId: string, date: string, signal?: AbortSignal) {
  const sp = new URLSearchParams({ employee_id: employeeId, date })
  return request<EntryDetail>(`/timesheet/entry?${sp.toString()}`, { signal })
}

export function upsertEntry(payload: EntryUpsertPayload) {
  return request<{ message: string }>('/timesheet/entry', {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function fillFact(week: string | undefined, force = false) {
  return request<{ message: string }>('/timesheet/fill-fact', {
    method: 'POST',
    body: JSON.stringify({ week: week ?? null, force }),
  })
}

export function dayFactBulk(workDate: string, items: DayFactItem[]) {
  return request<{ message: string }>('/timesheet/day-fact', {
    method: 'PUT',
    body: JSON.stringify({ work_date: workDate, items }),
  })
}

export function bulkPlan(payload: {
  work_date: string
  employee_ids: string[]
  planned_start: string
  planned_end: string
}) {
  return request<{ message: string }>('/timesheet/plan/bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getPayroll(week: string | undefined, signal?: AbortSignal) {
  const q = week ? `?week=${encodeURIComponent(week)}` : ''
  return request<PayrollResponse>(`/timesheet/payroll${q}`, { signal })
}

export function addPayment(payload: PaymentCreatePayload) {
  return request<{ message: string }>('/timesheet/payments', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function cancelPayment(paymentId: string) {
  return request<{ message: string }>(`/timesheet/payments/${paymentId}`, {
    method: 'DELETE',
  })
}

export function settleAll(week: string | undefined) {
  return request<{ message: string }>('/timesheet/payroll/settle-all', {
    method: 'POST',
    body: JSON.stringify({ week: week ?? null }),
  })
}

// --- Labels & helpers ---

export const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  worked: 'Отработал',
  planned: 'Запланирован',
  absent: 'Не вышел',
  noplan: 'Без плана',
  not_called: 'Не вызван',
  off: 'Выходной',
}

export const DAY_STATUS_TONE: Record<DayStatus, string> = {
  worked: 'success',
  planned: 'info',
  absent: 'danger',
  noplan: 'warning',
  not_called: '',
  off: '',
}

/** Копейки → «12 000 ₽» (целые рубли для UI). */
export function fmtMoney(kopecks: number | null | undefined): string {
  if (kopecks == null) return '—'
  return `${Math.round(kopecks / 100).toLocaleString('ru-RU')} ₽`
}

/** Копейки → «12 000» без знака валюты. */
export function fmtMoneyShort(kopecks: number | null | undefined): string {
  if (kopecks == null) return '—'
  return Math.round(kopecks / 100).toLocaleString('ru-RU')
}

/** Ставка в копейках/час → «350 ₽/ч». */
export function fmtRate(kopecks: number | null | undefined): string {
  if (kopecks == null) return '—'
  return `${Math.round(kopecks / 100).toLocaleString('ru-RU')} ₽/ч`
}

/** Оклад в копейках/мес → «150 000 ₽/мес». */
export function fmtSalary(kopecks: number | null | undefined): string {
  if (kopecks == null) return '—'
  return `${Math.round(kopecks / 100).toLocaleString('ru-RU')} ₽/мес`
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null) return '—'
  return `${h.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ч`
}

/** Рубли (строка из инпута) → копейки. */
export function rublesToKopecks(rub: string | number): number {
  const n = typeof rub === 'number' ? rub : parseFloat(String(rub).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}
