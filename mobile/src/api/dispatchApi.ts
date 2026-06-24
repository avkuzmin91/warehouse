import { request } from './http'

// --- Types --- (подмножество backend/modules/dispatch/schemas.py)
export type DispatchStatus =
  | 'draft'
  | 'preparing'
  | 'awaiting_trip'
  | 'partially_shipped'
  | 'shipped'
  | 'cancelled'

export type DispatchCargoType = 'good' | 'defect'

export type DispatchListItem = {
  id: string
  doc_number: string
  cargo_type: DispatchCargoType
  client_name: string | null
  ship_date: string | null
  priority_rank: number | null
  status: DispatchStatus
  status_label: string
  sku_count: number
  total_qty: number
  total_shipped_qty: number
}

export type DispatchListResponse = { items: DispatchListItem[]; total: number; page: number; limit: number }

export type DispatchListParams = {
  page?: number
  limit?: number
  status?: string
  client_id?: string
  search?: string
  cargo_type?: DispatchCargoType
  available_for_trip_id?: string
}

// Отгрузки, которые можно увезти рейсом. Зеркало web DISPATCH_TRIP_SELECTABLE_STATUSES.
export const DISPATCH_TRIP_SELECTABLE_STATUSES = 'preparing,awaiting_trip,partially_shipped'

export type DispatchLineIn = {
  product_id: string
  product_name: string
  product_sku: string
  color_id?: string | null
  color_name?: string | null
  size_id?: string | null
  size_name?: string | null
  qty: number
  site_url?: string | null
  store_id?: string | null
  store_name?: string | null
}

export type DispatchDocCreate = {
  cargo_type?: DispatchCargoType
  client_id?: string | null
  client_name?: string | null
  logistics_cost?: number | null
  ship_date?: string | null
  comment?: string | null
  lines?: DispatchLineIn[]
}

export type DispatchLine = {
  id: string
  product_name: string
  product_sku: string
  color_name: string | null
  size_name: string | null
  qty: number
  shipped_qty: number
  store_name: string | null
  remaining: number
}

export type DispatchOp = {
  id: string
  op_type: string
  comment: string | null
  created_at: string
  created_by_email: string | null
}

export type DispatchDetail = {
  id: string
  doc_number: string
  cargo_type: DispatchCargoType
  client_name: string | null
  logistics_cost: number | null
  ship_date: string | null
  actual_ship_date: string | null
  comment: string | null
  status: DispatchStatus
  status_label: string
  priority_rank: number | null
  trips: { id: string; number: string }[]
  lines: DispatchLine[]
  ops: DispatchOp[]
  total_qty: number
}

export function getDispatch(id: string, signal?: AbortSignal): Promise<DispatchDetail> {
  return request<DispatchDetail>(`/dispatches/${id}`, { signal })
}

export function createDispatch(body: DispatchDocCreate): Promise<{ message: string }> {
  return request<{ message: string }>('/dispatches', { method: 'POST', body: JSON.stringify(body) })
}

export function advanceDispatch(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/dispatches/${id}/advance`, { method: 'POST' })
}

// --- API functions ---
export function getDispatches(params: DispatchListParams = {}, signal?: AbortSignal): Promise<DispatchListResponse> {
  const sp = new URLSearchParams()
  if (params.page)       sp.set('page', String(params.page))
  if (params.limit)      sp.set('limit', String(params.limit))
  if (params.status)     sp.set('status', params.status)
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  if (params.available_for_trip_id) sp.set('available_for_trip_id', params.available_for_trip_id)
  const q = sp.toString()
  return request<DispatchListResponse>(`/dispatches${q ? `?${q}` : ''}`, { signal })
}

// --- Labels ---
export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  draft: 'Создание',
  preparing: 'Подготовка отгрузки',
  awaiting_trip: 'Ожидает рейс',
  partially_shipped: 'Частично отгружено',
  shipped: 'Отгружено',
  cancelled: 'Аннулирована',
}

export function dispatchStatusTone(status: DispatchStatus): string {
  const map: Record<DispatchStatus, string> = {
    draft: '',
    preparing: 'info',
    awaiting_trip: 'warning',
    partially_shipped: 'warning',
    shipped: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}
