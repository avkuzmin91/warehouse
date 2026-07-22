import { request, requestForm, requestIdHeaders } from './http'

// --- Types --- (подмножество frontend/src/api/expensesApi.ts; суммы — копейки INTEGER)

export type ExpenseDictKind = 'categories' | 'payment-sources'

export type ExpenseDictItem = { id: string; name: string }

export type ExpenseKind = 'manual' | 'logistics' | 'rent' | 'salary' | 'recurring' | 'discount'
export type ExpensePaymentStatus = 'awaiting' | 'partially_paid' | 'paid' | 'cancelled'

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
  carrier_name: string | null
  payment_source_name: string | null
  supplier: string | null
  comment: string | null
  kind: ExpenseKind
  kind_label: string
  payment_status: ExpensePaymentStatus
  payment_status_label: string
  paid_on: string | null
  file_count: number
  created_at: string
}

export type ExpenseDetail = ExpenseListItem & {
  payments: ExpensePayment[]
  files: ExpenseFile[]
}

export type ExpenseListResponse = {
  items: ExpenseListItem[]
  total: number
  page: number
  limit: number
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
}

export type ExpensePayPayload = {
  paid_on?: string | null
  payment_source_id?: string | null
  amount?: number | null
}

export type ExpenseListParams = {
  page?: number
  limit?: number
  search?: string
  category_id?: string
  payment_status?: string
  kinds?: string
}

// --- API functions ---

export function getExpenses(params: ExpenseListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.category_id) sp.set('category_id', params.category_id)
  if (params.payment_status) sp.set('payment_status', params.payment_status)
  if (params.kinds) sp.set('kinds', params.kinds)
  const q = sp.toString()
  return request<ExpenseListResponse>(`/expenses${q ? `?${q}` : ''}`, { signal })
}

export function getExpense(expenseId: string, signal?: AbortSignal) {
  return request<ExpenseDetail>(`/expenses/${expenseId}`, { signal })
}

export function createExpense(payload: ExpensePayload, requestId?: string) {
  return request<{ message: string }>('/expenses', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: requestIdHeaders(requestId),
  })
}

// Оплата: без amount — полная, с amount — частичная (копейки).
export function payExpense(expenseId: string, payload: ExpensePayPayload = {}) {
  return request<{ message: string }>(`/expenses/${expenseId}/pay`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function uploadExpenseFile(expenseId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return requestForm<{ message: string }>(`/expenses/${expenseId}/files`, {
    method: 'POST',
    body: form,
  })
}

export function getExpenseDict(kind: ExpenseDictKind, signal?: AbortSignal) {
  return request<ExpenseDictItem[]>(`/expenses/dict/${kind}`, { signal })
}

// --- Labels & helpers ---

export const EXPENSE_KIND_LABELS: Record<ExpenseKind, string> = {
  manual: 'Хозрасход',
  logistics: 'Логистика',
  rent: 'Аренда',
  salary: 'Зарплата',
  recurring: 'Регулярный',
  discount: 'Скидка клиенту',
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
