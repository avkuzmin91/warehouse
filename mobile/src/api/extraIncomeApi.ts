import { request, requestIdHeaders } from './http'

// --- Types --- (подмножество frontend/src/api/extraIncomeApi.ts; суммы — копейки INTEGER)

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
}

// --- API functions ---

export function getExtraIncome(params: ExtraIncomeListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.client_id) sp.set('client_id', params.client_id)
  const q = sp.toString()
  return request<ExtraIncomeListResponse>(`/extra-income${q ? `?${q}` : ''}`, { signal })
}

export function getExtraIncomeSummary(signal?: AbortSignal) {
  return request<ExtraIncomeSummary>('/extra-income/summary', { signal })
}

export function createExtraIncome(payload: ExtraIncomePayload, requestId?: string) {
  return request<{ message: string }>('/extra-income', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: requestIdHeaders(requestId),
  })
}

export function getExtraIncomeCategories(signal?: AbortSignal) {
  return request<ExtraIncomeCategory[]>('/extra-income/categories', { signal })
}
