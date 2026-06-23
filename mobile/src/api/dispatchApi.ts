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
