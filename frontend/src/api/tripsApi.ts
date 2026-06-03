import { request } from './http'

// --- Types ---

export type TripStatus =
  | 'draft'
  | 'awaiting_arrival'
  | 'unloading'
  | 'costing'
  | 'closed'
  | 'cancelled'

export type TripLoadFactor = 'full' | 'partial'

export type TripDoc = {
  id: string
  trip_number: string
  direction: string
  status: TripStatus
  assignee_role: string | null
  origin_id: string | null
  origin_name: string | null
  carrier_id: string | null
  carrier_name: string | null
  vehicle_type_id: string | null
  vehicle_type_name: string | null
  transport_ordered_at: string | null
  eta: string | null
  cost_estimate: number | null
  comment: string | null
  arrived_at: string | null
  unload_finished_at: string | null
  load_factor: TripLoadFactor | null
  logistics_cost_actual: number | null
  waiting_cost: number | null
  waiting_minutes: number | null
  created_at: string
  created_by: string | null
  updated_at: string | null
}

export type TripReceiptItem = {
  line_id: string
  receipt_doc_id: string
  receipt_number: string | null
  receipt_status: string | null
  client_id: string | null
  client_name: string | null
}

export type TripOp = {
  id: string
  trip_id: string
  op_type: string
  comment: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
}

export type TripDetail = {
  doc: TripDoc
  receipts: TripReceiptItem[]
  ops: TripOp[]
}

export type TripListItem = {
  id: string
  trip_number: string
  direction: string
  status: TripStatus
  origin_name: string | null
  carrier_name: string | null
  vehicle_type_name: string | null
  eta: string | null
  arrived_at: string | null
  cost_estimate: number | null
  logistics_cost_actual: number | null
  created_at: string
  receipts_count: number
}

export type TripListResponse = {
  items: TripListItem[]
  total: number
  page: number
  limit: number
}

export type TripCreatePayload = {
  origin_id?: string | null
  origin_name?: string | null
  carrier_id?: string | null
  carrier_name?: string | null
  vehicle_type_id?: string | null
  vehicle_type_name?: string | null
  transport_ordered_at?: string | null
  eta?: string | null
  cost_estimate?: number | null
  comment?: string | null
  receipt_doc_ids?: string[]
}

export type TripUpdatePayload = Omit<TripCreatePayload, 'receipt_doc_ids'>

export type TripCostPayload = {
  logistics_cost_actual?: number | null
  waiting_cost?: number | null
  waiting_minutes?: number | null
}

export type TripListParams = {
  page?: number
  limit?: number
  status?: TripStatus
  carrier_id?: string
  search?: string
}

// --- API functions ---

export function getTrips(params: TripListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.status) sp.set('status', params.status)
  if (params.carrier_id) sp.set('carrier_id', params.carrier_id)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<TripListResponse>(`/trips${q ? `?${q}` : ''}`, { signal })
}

export function getTrip(tripId: string, signal?: AbortSignal) {
  return request<TripDetail>(`/trips/${tripId}`, { signal })
}

export function createTrip(payload: TripCreatePayload) {
  return request<{ message: string }>('/trips', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTrip(tripId: string, payload: TripUpdatePayload) {
  return request<{ message: string }>(`/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function linkTripReceipts(tripId: string, receiptDocIds: string[]) {
  return request<{ message: string }>(`/trips/${tripId}/receipts`, {
    method: 'POST',
    body: JSON.stringify({ receipt_doc_ids: receiptDocIds }),
  })
}

export function unlinkTripReceipt(tripId: string, receiptDocId: string) {
  return request<{ message: string }>(`/trips/${tripId}/receipts/${receiptDocId}`, {
    method: 'DELETE',
  })
}

export function handoffTrip(tripId: string) {
  return request<{ message: string }>(`/trips/${tripId}/handoff`, { method: 'POST' })
}

export function tripArrival(tripId: string, arrivedAt?: string) {
  return request<{ message: string }>(`/trips/${tripId}/arrival`, {
    method: 'POST',
    body: JSON.stringify({ arrived_at: arrivedAt ?? null }),
  })
}

export function tripUnload(tripId: string, payload: { unload_finished_at?: string | null; load_factor?: TripLoadFactor | null }) {
  return request<{ message: string }>(`/trips/${tripId}/unload`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function tripCost(tripId: string, payload: TripCostPayload) {
  return request<{ message: string }>(`/trips/${tripId}/cost`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function closeTrip(tripId: string) {
  return request<{ message: string }>(`/trips/${tripId}/close`, { method: 'POST' })
}

export function cancelTrip(tripId: string) {
  return request<{ message: string }>(`/trips/${tripId}/cancel`, { method: 'POST' })
}

// --- Labels & helpers ---

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  draft: 'Черновик',
  awaiting_arrival: 'Ожидает прибытия',
  unloading: 'Разгрузка',
  costing: 'Уточнение стоимости',
  closed: 'Закрыт',
  cancelled: 'Аннулирован',
}

export const TRIP_LOAD_LABELS: Record<TripLoadFactor, string> = {
  full: 'Полная',
  partial: 'Неполная',
}

export function tripStatusTone(status: TripStatus): string {
  const map: Record<TripStatus, string> = {
    draft: '',
    awaiting_arrival: 'info',
    unloading: 'warning',
    costing: 'warning',
    closed: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}
