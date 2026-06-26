import { request } from './http'

// --- Types ---

export type RecurringFrequency = 'daily' | 'monthly'

export type RecurringRateEntry = {
  id: string
  amount_kop: number
  effective_from: string
  note: string | null
  created_at: string
  created_by: string | null
}

export type RecurringTemplateItem = {
  id: string
  name: string
  category_id: string | null
  category_name: string | null
  payment_source_id: string | null
  payment_source_name: string | null
  supplier: string | null
  frequency: RecurringFrequency
  frequency_label: string
  month_day: number | null
  start_date: string
  end_date: string | null
  is_active: boolean
  current_amount_kop: number | null
  created_at: string
}

export type RecurringTemplateDetail = RecurringTemplateItem & {
  rates: RecurringRateEntry[]
}

export type RecurringTemplateListResponse = {
  items: RecurringTemplateItem[]
  total: number
  page: number
  limit: number
}

export type RecurringTemplateCreatePayload = {
  name: string
  category_id?: string | null
  payment_source_id?: string | null
  supplier?: string | null
  frequency: RecurringFrequency
  month_day?: number | null
  start_date?: string | null
  end_date?: string | null
  is_active?: boolean
  amount_kop?: number | null
}

export type RecurringTemplateUpdatePayload = {
  name?: string
  category_id?: string | null
  payment_source_id?: string | null
  supplier?: string | null
  frequency?: RecurringFrequency
  month_day?: number | null
  start_date?: string | null
  end_date?: string | null
  is_active?: boolean
}

export type SetRecurringRatePayload = {
  amount_kop: number
  effective_from?: string
  note?: string
}

export type RecurringOutstanding = {
  template_id: string
  template_name: string
  outstanding_amount: number
  count: number
}

export type RecurringPayPayload = {
  template_id: string
  amount: number
  payment_source_id: string
  paid_on?: string | null
}

export type RecurringPayResult = {
  allocated_amount: number
  affected_count: number
  fully_paid_count: number
  partially_paid_count: number
}

export type RecurringListParams = {
  page?: number
  limit?: number
  search?: string
  active_only?: boolean
}

// --- API functions ---

export function getRecurringTemplates(params: RecurringListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.active_only) sp.set('active_only', 'true')
  const q = sp.toString()
  return request<RecurringTemplateListResponse>(`/recurring-expenses${q ? `?${q}` : ''}`, { signal })
}

export function getRecurringTemplate(templateId: string, signal?: AbortSignal) {
  return request<RecurringTemplateDetail>(`/recurring-expenses/${templateId}`, { signal })
}

export function createRecurringTemplate(payload: RecurringTemplateCreatePayload) {
  return request<{ message: string }>('/recurring-expenses', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateRecurringTemplate(templateId: string, payload: RecurringTemplateUpdatePayload) {
  return request<{ message: string }>(`/recurring-expenses/${templateId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteRecurringTemplate(templateId: string) {
  return request<{ message: string }>(`/recurring-expenses/${templateId}`, { method: 'DELETE' })
}

export function setRecurringRate(templateId: string, payload: SetRecurringRatePayload) {
  return request<{ message: string }>(`/recurring-expenses/${templateId}/rates`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteRecurringRate(templateId: string, rateId: string) {
  return request<{ message: string }>(`/recurring-expenses/${templateId}/rates/${rateId}`, {
    method: 'DELETE',
  })
}

export function getRecurringOutstanding(signal?: AbortSignal) {
  return request<RecurringOutstanding[]>('/recurring-expenses/outstanding', { signal })
}

export function payRecurring(payload: RecurringPayPayload) {
  return request<RecurringPayResult>('/recurring-expenses/pay', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function runRecurringAccruals(params: { on_date?: string; date_from?: string; date_to?: string } = {}) {
  const sp = new URLSearchParams()
  if (params.on_date) sp.set('on_date', params.on_date)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<{ created: number; on_date: string }>(`/recurring-expenses/accruals/run${q ? `?${q}` : ''}`, {
    method: 'POST',
  })
}
