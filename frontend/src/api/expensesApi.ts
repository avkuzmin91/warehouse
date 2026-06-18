import { request, requestForm } from './http'

// --- Types ---

export type ExpenseDictKind = 'categories' | 'payment-sources'

export type ExpenseDictItem = { id: string; name: string }

export type ExpenseKind = 'manual' | 'logistics' | 'rent' | 'salary'
export type ExpensePaymentStatus = 'awaiting' | 'paid' | 'cancelled'

export type ExpenseOpType =
  | 'create' | 'update' | 'delete' | 'restore' | 'file_add' | 'file_delete' | 'pay' | 'cancel'

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
  file_count: number
  created_at: string
  created_by_email: string | null
}

export type ExpenseDetail = ExpenseListItem & {
  updated_at: string | null
  source_trip_number: string | null
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
  paid_amount: number
  by_category: ExpenseSummaryBreakdown[]
  by_payment_source: ExpenseSummaryBreakdown[]
}

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
  const q = sp.toString()
  return q ? `?${q}` : ''
}

export function getExpenses(params: ExpenseListParams = {}, signal?: AbortSignal) {
  return request<ExpenseListResponse>(`/expenses${expenseQuery(params)}`, { signal })
}

export function getExpensesSummary(params: ExpenseSummaryParams = {}, signal?: AbortSignal) {
  return request<ExpenseSummary>(`/expenses/summary${expenseQuery(params)}`, { signal })
}

export function getExpense(expenseId: string, signal?: AbortSignal) {
  return request<ExpenseDetail>(`/expenses/${expenseId}`, { signal })
}

export function createExpense(payload: ExpensePayload) {
  return request<{ message: string }>('/expenses', {
    method: 'POST',
    body: JSON.stringify(payload),
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

export function cancelExpense(expenseId: string) {
  return request<{ message: string }>(`/expenses/${expenseId}/cancel`, { method: 'POST' })
}

export function runSalaryAccruals(onDate?: string) {
  const q = onDate ? `?on_date=${onDate}` : ''
  return request<{ created: number; on_date: string }>(`/expenses/salary/accruals/run${q}`, { method: 'POST' })
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
  cancel: 'Аннулирование',
}

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  manual: 'Хозрасход',
  logistics: 'Логистика',
  rent: 'Аренда',
  salary: 'Зарплата',
}

export const EXPENSE_PAYMENT_STATUS_LABELS: Record<ExpensePaymentStatus, string> = {
  awaiting: 'Ожидает оплаты',
  paid: 'Оплачен',
  cancelled: 'Аннулирован',
}

/** Тон бейджа статуса оплаты для Badge: оплачено — success, ожидает — warning, отменён — нейтральный. */
export function expensePaymentTone(status: ExpensePaymentStatus): 'success' | 'warning' | '' {
  if (status === 'paid') return 'success'
  if (status === 'awaiting') return 'warning'
  return ''
}

/** Производная цена за единицу (копейки) — сумма ÷ количество. */
export function unitPriceKopecks(amount: number, quantity: number): number | null {
  if (!quantity || quantity <= 0) return null
  return Math.round(amount / quantity)
}
