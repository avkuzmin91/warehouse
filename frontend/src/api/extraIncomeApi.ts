import { request } from './http'

// --- Types ---

export type ExtraIncomeCategory = { id: string; name: string }

export type ExtraIncomeListItem = {
  id: string
  entry_date: string
  client_id: string
  client_name: string | null
  category_id: string | null
  category_name: string | null
  qty: number | null
  amount_kop: number
  comment: string | null
  invoice_id: string | null
  invoice_number: string | null
  created_at: string
}

export type ExtraIncomeListResponse = {
  items: ExtraIncomeListItem[]
  total: number
  page: number
  limit: number
}

export type ExtraIncomeSummary = {
  total_amount: number
  total_count: number
  uninvoiced_amount: number
  uninvoiced_count: number
}

export type ExtraIncomePayload = {
  entry_date: string
  client_id: string
  category_id: string
  qty?: number | null
  amount_kop: number
  comment?: string | null
}

export type ExtraIncomeListParams = {
  page?: number
  limit?: number
  search?: string
  client_id?: string
  category_id?: string
  date_from?: string
  date_to?: string
  invoiced?: '1' | '0'
}

export type ExtraIncomeSummaryParams = Omit<ExtraIncomeListParams, 'page' | 'limit' | 'invoiced'>

// --- API functions ---

function extraIncomeQuery(params: ExtraIncomeListParams): string {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.category_id) sp.set('category_id', params.category_id)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  if (params.invoiced) sp.set('invoiced', params.invoiced)
  const q = sp.toString()
  return q ? `?${q}` : ''
}

export function getExtraIncome(params: ExtraIncomeListParams = {}, signal?: AbortSignal) {
  return request<ExtraIncomeListResponse>(`/extra-income${extraIncomeQuery(params)}`, { signal })
}

export function getExtraIncomeSummary(params: ExtraIncomeSummaryParams = {}, signal?: AbortSignal) {
  return request<ExtraIncomeSummary>(`/extra-income/summary${extraIncomeQuery(params)}`, { signal })
}

export function createExtraIncome(payload: ExtraIncomePayload) {
  return request<{ message: string }>('/extra-income', {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotent: true,
  })
}

export function updateExtraIncome(entryId: string, payload: ExtraIncomePayload) {
  return request<{ message: string }>(`/extra-income/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteExtraIncome(entryId: string) {
  return request<{ message: string }>(`/extra-income/${entryId}`, { method: 'DELETE' })
}

// --- Categories (справочник видов работ) ---

export function getExtraIncomeCategories(signal?: AbortSignal) {
  return request<ExtraIncomeCategory[]>('/extra-income/categories', { signal })
}

export function createExtraIncomeCategory(name: string) {
  return request<{ message: string }>('/extra-income/categories', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function updateExtraIncomeCategory(itemId: string, name: string) {
  return request<{ message: string }>(`/extra-income/categories/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function deleteExtraIncomeCategory(itemId: string) {
  return request<{ message: string }>(`/extra-income/categories/${itemId}`, { method: 'DELETE' })
}
