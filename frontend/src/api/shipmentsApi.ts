import { request } from './http'

export type ShipmentStatus = 'draft' | 'packing' | 'ready' | 'shipped' | 'cancelled'

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft:     'Создание',
  packing:   'Сборка',
  ready:     'Отправление',
  shipped:   'Завершение',
  cancelled: 'Отменено',
}

export const SHIPMENT_STEP_DONE_LABELS: Record<ShipmentStatus, string> = {
  draft:     'Создан',
  packing:   'Собран',
  ready:     'Отправлен',
  shipped:   'Завершён',
  cancelled: 'Отменён',
}

export const SHIPMENT_STATUS_TONES: Record<ShipmentStatus, string> = {
  draft:     '',
  packing:   'info',
  ready:     'accent',
  shipped:   'success',
  cancelled: 'danger',
}

export const SHIPMENT_STATUS_ORDER: ShipmentStatus[] = [
  'draft', 'packing', 'ready', 'shipped',
]

export type ShipmentCargoType = 'good' | 'defect'

export const SHIPMENT_CARGO_LABELS: Record<ShipmentCargoType, string> = {
  good:   'Годный товар',
  defect: 'Брак',
}

export type ShipmentOpType = 'doc_create' | 'advance' | 'revert' | 'cancel' | 'doc_update'

export type ShipmentOp = {
  id:               string
  op_type:          ShipmentOpType
  comment:          string | null
  created_at:       string
  created_by:       string | null
  created_by_email: string | null
}

export type ShipmentLine = {
  id:           string
  product_id:   string
  product_name: string
  product_sku:  string
  color_id:     string | null
  color_name:   string | null
  size_id:      string | null
  size_name:    string | null
  qty:          number
}

export type ShipmentListItem = {
  id:             string
  doc_number:     string
  cargo_type:     ShipmentCargoType
  client_id:      string | null
  client_name:    string | null
  destination:    string | null
  carrier:        string | null
  logistics_cost: number | null
  ship_date:      string | null
  status:         ShipmentStatus
  status_label:   string
  sku_count:      number
  total_qty:      number
  created_at:     string
}

export type ShipmentDetail = ShipmentListItem & {
  comment:    string | null
  created_by: string | null
  updated_at: string | null
  lines:      ShipmentLine[]
  ops:        ShipmentOp[]
  total_qty:  number
}

export type ShipmentListResponse = {
  items: ShipmentListItem[]
  total: number
  page:  number
  limit: number
}

export type ShipmentListParams = {
  page?:      number
  limit?:     number
  status?:    ShipmentStatus
  client_id?: string
  search?:    string
  date_from?: string
  date_to?:   string
}

export type ShipmentsSummary = {
  all:     number
  active:  number
  done:    number
  packing: number
  ready:   number
}

export type ShipmentLineIn = {
  product_id:   string
  product_name: string
  product_sku:  string
  color_id?:    string | null
  color_name?:  string | null
  size_id?:     string | null
  size_name?:   string | null
  qty:          number
}

export type ShipmentDocCreate = {
  cargo_type?:     ShipmentCargoType
  client_id?:      string | null
  client_name?:    string | null
  destination?:    string | null
  carrier?:        string | null
  logistics_cost?: number | null
  ship_date?:      string | null
  comment?:        string | null
  lines?:          ShipmentLineIn[]
}

export type ShipmentDocUpdate = Omit<ShipmentDocCreate, 'lines'>

export function getShipmentsSummary(params: Pick<ShipmentListParams, 'client_id' | 'search' | 'date_from' | 'date_to'> = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to)   sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<ShipmentsSummary>(`/shipments/summary${q ? `?${q}` : ''}`, { signal })
}

export function listShipments(params: ShipmentListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page)      sp.set('page', String(params.page))
  if (params.limit)     sp.set('limit', String(params.limit))
  if (params.status)    sp.set('status', params.status)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to)   sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<ShipmentListResponse>(`/shipments${q ? `?${q}` : ''}`, { signal })
}

export function getShipment(id: string) {
  return request<ShipmentDetail>(`/shipments/${id}`)
}

export function createShipment(body: ShipmentDocCreate) {
  return request<{ message: string }>('/shipments', { method: 'POST', body: JSON.stringify(body) })
}

export function updateShipment(id: string, body: ShipmentDocUpdate) {
  return request<{ message: string }>(`/shipments/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function addShipmentLine(docId: string, line: ShipmentLineIn) {
  return request<{ message: string }>(`/shipments/${docId}/lines`, { method: 'POST', body: JSON.stringify(line) })
}

export function updateShipmentLine(docId: string, lineId: string, line: ShipmentLineIn) {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(line) })
}

export function deleteShipmentLine(docId: string, lineId: string) {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}`, { method: 'DELETE' })
}

export function advanceShipment(id: string) {
  return request<{ message: string }>(`/shipments/${id}/advance`, { method: 'POST' })
}

export function revertShipment(id: string) {
  return request<{ message: string }>(`/shipments/${id}/revert`, { method: 'POST' })
}

export function cancelShipment(id: string) {
  return request<{ message: string }>(`/shipments/${id}/cancel`, { method: 'POST' })
}

export function deleteShipment(id: string) {
  return request<{ message: string }>(`/shipments/${id}`, { method: 'DELETE' })
}
