import { request, requestForm } from './http'

// --- Types ---

export type ExpenseDictKind = 'categories' | 'payment-sources'

export type ExpenseDictItem = { id: string; name: string }

export type ExpenseKind = 'manual' | 'logistics' | 'rent' | 'salary' | 'recurring'
export type ExpensePaymentStatus = 'awaiting' | 'partially_paid' | 'paid' | 'cancelled'
// Подтип ЗП (производный от source_kind): оклад vs табель — разносим на витринах, чтобы не смешивались.
export type SalarySubtype = 'fixed' | 'timesheet'

export type ExpenseOpType =
  | 'create' | 'update' | 'delete' | 'restore' | 'file_add' | 'file_delete'
  | 'pay' | 'payment' | 'unpay' | 'cancel'

export type ExpenseOp = {
  id: string
  op_type: ExpenseOpType
  op_label: string
  comment: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
}

export type ExpenseFile = {
  id: string
  filename: string
  url: string
  mime_type: string | null
  created_at: string
}

export type ExpensePayment = {
  id: string
  amount: number
  paid_on: string | null
  payment_source_id: string | null
  payment_source_name: string | null
  comment: string | null
  created_at: string
  created_by_email: string | null
}

export type ExpenseListItem = {
  id: string
  exp_number: string
  spent_on: string
  category_id: string | null
  category_name: string | null
  name: string
  quantity: number
  unit: string | null
  amount: number
  paid_amount: number
  carrier_id: string | null
  carrier_name: string | null
  payment_source_id: string | null
  payment_source_name: string | null
  supplier: string | null
  comment: string | null
  kind: ExpenseKind
  kind_label: string
  payment_status: ExpensePaymentStatus
  payment_status_label: string
  paid_on: string | null
  period_start: string | null
  period_end: string | null
  source_kind: string | null
  source_id: string | null
  salary_subtype: SalarySubtype | null
  salary_subtype_label: string | null
  file_count: number
  created_at: string
  created_by_email: string | null
}

export type ExpenseDetail = ExpenseListItem & {
  updated_at: string | null
  source_trip_number: string | null
  payments: ExpensePayment[]
  files: ExpenseFile[]
  ops: ExpenseOp[]
}

export type ExpenseListResponse = {
  items: ExpenseListItem[]
  total: number
  page: number
  limit: number
}

export type ExpenseSummaryBreakdown = {
  id: string | null
  name: string
  amount: number
  count: number
}

export type ExpenseSummary = {
  total_amount: number
  total_count: number
  awaiting_amount: number
  awaiting_count: number
  paid_amount: number
  by_category: ExpenseSummaryBreakdown[]
  by_payment_source: ExpenseSummaryBreakdown[]
}

export type ExpenseAnalyticsPoint = { date: string; amount: number }
export type ExpenseAnalyticsCategory = { id: string | null; name: string; kind: ExpenseKind; series: number[] }
export type ExpenseAnalyticsKind = { kind: ExpenseKind; kind_label: string; amount: number; count: number }
export type ExpenseAnalyticsStatus = { payment_status: ExpensePaymentStatus; label: string; amount: number; count: number }
export type ExpenseAnalytics = {
  date_from: string
  date_to: string
  days: number
  total_amount: number
  avg_per_day: number
  max_day_amount: number
  series: ExpenseAnalyticsPoint[]
  categories: ExpenseAnalyticsCategory[]
  by_kind: ExpenseAnalyticsKind[]
  by_category: ExpenseSummaryBreakdown[]
  by_status: ExpenseAnalyticsStatus[]
}

export type ExpenseAnalyticsParams = { date_from: string; date_to: string; kinds?: string }

export type ExpensePayload = {
  spent_on: string
  category_id?: string | null
  name: string
  quantity?: number
  unit?: string | null
  amount: number
  payment_source_id?: string | null
  supplier?: string | null
  comment?: string | null
  kind?: ExpenseKind
  payment_status?: ExpensePaymentStatus
  paid_on?: string | null
  period_start?: string | null
  period_end?: string | null
  source_kind?: string | null
  source_id?: string | null
}

export type ExpensePayPayload = {
  paid_on?: string | null
  payment_source_id?: string | null
  amount?: number | null
}

export type CarrierOutstanding = {
  carrier_id: string
  carrier_name: string
  outstanding_amount: number
  count: number
}

export type CarrierPayPayload = {
  carrier_id: string
  amount: number
  payment_source_id: string
  paid_on?: string | null
}

export type CarrierPayResult = {
  allocated_amount: number
  affected_count: number
  fully_paid_count: number
  partially_paid_count: number
}

export type ExpenseListParams = {
  page?: number
  limit?: number
  search?: string
  category_id?: string
  payment_source_id?: string
  date_from?: string
  date_to?: string
  kind?: string
  kinds?: string
  payment_status?: string
  salary_subtype?: string
}

export type ExpenseSummaryParams = Omit<ExpenseListParams, 'page' | 'limit'>

// --- API functions ---

function expenseQuery(params: ExpenseListParams): string {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.category_id) sp.set('category_id', params.category_id)
  if (params.payment_source_id) sp.set('payment_source_id', params.payment_source_id)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  if (params.kind) sp.set('kind', params.kind)
  if (params.kinds) sp.set('kinds', params.kinds)
  if (params.payment_status) sp.set('payment_status', params.payment_status)
  if (params.salary_subtype) sp.set('salary_subtype', params.salary_subtype)
  const q = sp.toString()
  return q ? `?${q}` : ''
}

export function getExpenses(params: ExpenseListParams = {}, signal?: AbortSignal) {
  return request<ExpenseListResponse>(`/expenses${expenseQuery(params)}`, { signal })
}

export function getExpensesSummary(params: ExpenseSummaryParams = {}, signal?: AbortSignal) {
  return request<ExpenseSummary>(`/expenses/summary${expenseQuery(params)}`, { signal })
}

export function getExpenseAnalytics(params: ExpenseAnalyticsParams, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.kinds) sp.set('kinds', params.kinds)
  return request<ExpenseAnalytics>(`/expenses/analytics?${sp.toString()}`, { signal })
}

export function getExpense(expenseId: string, signal?: AbortSignal) {
  return request<ExpenseDetail>(`/expenses/${expenseId}`, { signal })
}

export function createExpense(payload: ExpensePayload) {
  return request<{ message: string }>('/expenses', {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotent: true,
  })
}

export function updateExpense(expenseId: string, payload: ExpensePayload) {
  return request<{ message: string }>(`/expenses/${expenseId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function payExpense(expenseId: string, payload: ExpensePayPayload = {}) {
  return request<{ message: string }>(`/expenses/${expenseId}/pay`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function unpayExpense(expenseId: string) {
  return request<{ message: string }>(`/expenses/${expenseId}/unpay`, { method: 'POST' })
}

export function getCarriersOutstanding(signal?: AbortSignal) {
  return request<CarrierOutstanding[]>('/expenses/carriers/outstanding', { signal })
}

export function payCarrier(payload: CarrierPayPayload) {
  return request<CarrierPayResult>('/expenses/pay-carrier', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function cancelExpense(expenseId: string) {
  return request<{ message: string }>(`/expenses/${expenseId}/cancel`, { method: 'POST' })
}

export function runSalaryAccruals(onDate?: string) {
  const q = onDate ? `?on_date=${onDate}` : ''
  return request<{ created: number; on_date: string }>(`/expenses/salary/accruals/run${q}`, { method: 'POST' })
}

export function runRentAccruals(onDate?: string) {
  const q = onDate ? `?on_date=${onDate}` : ''
  return request<{ created: number; on_date: string }>(`/expenses/rent/accruals/run${q}`, { method: 'POST' })
}

export function uploadExpenseFile(expenseId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return requestForm<{ message: string }>(`/expenses/${expenseId}/files`, {
    method: 'POST',
    body: form,
  })
}

export function deleteExpenseFile(expenseId: string, fileId: string) {
  return request<{ message: string }>(`/expenses/${expenseId}/files/${fileId}`, { method: 'DELETE' })
}

// --- Dictionaries (categories, payment sources) ---

export function getExpenseDict(kind: ExpenseDictKind, signal?: AbortSignal) {
  return request<ExpenseDictItem[]>(`/expenses/dict/${kind}`, { signal })
}

export function createExpenseDictItem(kind: ExpenseDictKind, name: string) {
  return request<{ message: string }>(`/expenses/dict/${kind}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function updateExpenseDictItem(kind: ExpenseDictKind, itemId: string, name: string) {
  return request<{ message: string }>(`/expenses/dict/${kind}/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteExpenseDictItem(kind: ExpenseDictKind, itemId: string) {
  return request<{ message: string }>(`/expenses/dict/${kind}/${itemId}`, { method: 'DELETE' })
}

// --- Labels & helpers ---

export const EXPENSE_OP_LABELS: Record<ExpenseOpType, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  restore: 'Восстановление',
  file_add: 'Файл прикреплён',
  file_delete: 'Файл удалён',
  pay: 'Оплачено',
  payment: 'Оплата',
  unpay: 'Оплата отменена',
  cancel: 'Аннулирование',
}

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  manual: 'Хозрасход',
  logistics: 'Логистика',
  rent: 'Аренда',
  salary: 'Зарплата',
  recurring: 'Регулярный',
}

export const SALARY_SUBTYPE_LABELS: Record<SalarySubtype, string> = {
  fixed: 'Оклад (фикс)',
  timesheet: 'Табель (почасовая)',
}

export const EXPENSE_PAYMENT_STATUS_LABELS: Record<ExpensePaymentStatus, string> = {
  awaiting: 'Ожидает оплаты',
  partially_paid: 'Частично оплачен',
  paid: 'Оплачен',
  cancelled: 'Аннулирован',
}

/** Тон бейджа статуса оплаты: оплачено — success, частично — info, ожидает — warning, отменён — нейтральный. */
export function expensePaymentTone(status: ExpensePaymentStatus): 'success' | 'warning' | 'info' | '' {
  if (status === 'paid') return 'success'
  if (status === 'partially_paid') return 'info'
  if (status === 'awaiting') return 'warning'
  return ''
}

/** Доля оплаты 0..1 для прогресс-бара (защищён от деления на ноль). */
export function expensePaidFraction(amount: number, paidAmount: number): number {
  if (!amount || amount <= 0) return 0
  return Math.max(0, Math.min(1, paidAmount / amount))
}

/** Производная цена за единицу (копейки) — сумма ÷ количество. */
export function unitPriceKopecks(amount: number, quantity: number): number | null {
  if (!quantity || quantity <= 0) return null
  return Math.round(amount / quantity)
}
