import { request, requestForm, requestIdHeaders } from './http'

// --- Types --- (зеркало backend/modules/shipments/schemas.py)
export type ShipmentStatus =
  | 'draft'
  | 'packing'
  | 'on_packing'
  | 'relocating'
  | 'awaiting_trip'
  | 'partially_shipped'
  | 'shipped'
  | 'completed_no_goods'
  | 'cancelled'

export type ShipmentPlacement = { kind: 'good' | 'defect'; zone_id: string | null; zone_name: string | null; qty: number }

export type ShipmentLine = {
  id: string
  product_id: string
  product_name: string
  product_sku: string
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  qty: number
  shipped_qty: number
  packed_good: number
  packed_defect: number
  available_for_pack: number
  store_id: string | null
  store_name: string | null
  placements: ShipmentPlacement[]
}

export type ShipmentDetail = {
  id: string
  doc_number: string
  cargo_type: 'good' | 'defect'
  client_id: string | null
  client_name: string | null
  destination: string | null
  carrier: string | null
  ship_date: string | null
  comment: string | null
  status: ShipmentStatus
  status_label: string
  lines: ShipmentLine[]
}

export type ShipmentListItem = {
  id: string
  doc_number: string
  cargo_type: 'good' | 'defect'
  client_name: string | null
  ship_date: string | null
  status: ShipmentStatus
  status_label: string
  sku_count: number
  total_qty: number
  priority_rank: number | null
}

export type ShipmentListResponse = { items: ShipmentListItem[]; total: number; page: number; limit: number }

// --- API functions ---
export function getShipments(status: string, limit = 50, signal?: AbortSignal): Promise<ShipmentListResponse> {
  const sp = new URLSearchParams()
  sp.set('status', status)
  sp.set('limit', String(limit))
  return request<ShipmentListResponse>(`/shipments?${sp.toString()}`, { signal })
}

export function getShipment(id: string, signal?: AbortSignal): Promise<ShipmentDetail> {
  return request<ShipmentDetail>(`/shipments/${id}`, { signal })
}

export type ShipmentListParams = {
  page?: number
  limit?: number
  status?: string
  client_id?: string
  search?: string
  cargo_type?: 'good' | 'defect'
}

export type ShipmentLineIn = {
  product_id: string
  product_name: string
  product_sku: string
  color_id?: string | null
  color_name?: string | null
  size_id?: string | null
  size_name?: string | null
  qty: number
  storage_zone_id?: string | null
  storage_zone_name?: string | null
  store_id?: string | null
  store_name?: string | null
}

export type ShipmentDocCreate = {
  cargo_type?: 'good' | 'defect'
  client_id?: string | null
  client_name?: string | null
  ship_date?: string | null
  comment?: string | null
  lines?: ShipmentLineIn[]
}

export function createShipment(body: ShipmentDocCreate): Promise<{ message: string }> {
  return request<{ message: string }>('/shipments', { method: 'POST', body: JSON.stringify(body) })
}

export function uploadShipmentLineFile(docId: string, lineId: string, file: File): Promise<{ message: string }> {
  const form = new FormData()
  form.append('file', file)
  return requestForm<{ message: string }>(`/shipments/${docId}/lines/${lineId}/files`, { method: 'POST', body: form })
}

// Менеджерский список «Задач упаковки»: пагинация + фильтры (status опционален → все статусы).
export function listShipments(params: ShipmentListParams = {}, signal?: AbortSignal): Promise<ShipmentListResponse> {
  const sp = new URLSearchParams()
  if (params.page)       sp.set('page', String(params.page))
  if (params.limit)      sp.set('limit', String(params.limit))
  if (params.status)     sp.set('status', params.status)
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  const q = sp.toString()
  return request<ShipmentListResponse>(`/shipments${q ? `?${q}` : ''}`, { signal })
}

export type MoveAllocation = { from_zone_id: string | null; qty: number }

// Передача на упаковку: явная разбивка по зонам-источникам (как в вебе).
export function moveLineToPacking(docId: string, lineId: string, allocations: MoveAllocation[], requestId: string) {
  return request<{ message: string; moved: number }>(`/shipments/${docId}/lines/${lineId}/move-to-packing`, {
    method: 'POST',
    body: JSON.stringify({ allocations }),
    headers: requestIdHeaders(requestId),
  })
}

// Откат ошибочной передачи на упаковку: товар возвращается в исходные места хранения.
export function returnLineFromPacking(docId: string, lineId: string, qty?: number) {
  return request<{ message: string; returned: number }>(`/shipments/${docId}/lines/${lineId}/return-from-packing`, {
    method: 'POST',
    body: JSON.stringify({ qty: qty ?? null }),
  })
}

// packing → on_packing (передать начальнику смены).
export function advanceShipment(id: string, requestId: string) {
  return request<{ message: string }>(`/shipments/${id}/advance`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
  })
}

export type RelocateAllocation = { zone_id: string; zone_name: string | null; qty: number }
export type RelocateLine = { line_id: string; good: RelocateAllocation[]; defect: RelocateAllocation[] }

// relocating → awaiting_trip (раскладка годного/брака по местам).
export function finishRelocation(id: string, lines: RelocateLine[], requestId: string) {
  return request<{ message: string }>(`/shipments/${id}/finish-relocation`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
    headers: requestIdHeaders(requestId),
  })
}

// --- Упаковка (QC начальника смены): внесение годного/брака по строке ---
export type PackingPayload = { good_delta?: number; defect_delta?: number; packed_date: string }

// on_packing: внести годный и/или брак одной записью (дельты неотрицательны).
// requestId — идемпотентность: ретрай оборванного «Записать» не задвоит дельту.
export function recordPacking(docId: string, lineId: string, payload: PackingPayload, requestId?: string) {
  return request<{ message: string; packed_good: number; packed_defect: number }>(
    `/shipments/${docId}/lines/${lineId}/pack`,
    { method: 'POST', body: JSON.stringify(payload), headers: requestIdHeaders(requestId) },
  )
}

export type ShipmentPackingEntry = {
  id: string
  packed_date: string | null
  good: number
  defect: number
  created_at: string
  created_by_email: string | null
  reversed: boolean
}

export type ShipmentPackingResponse = {
  plan: number
  available_for_pack: number
  packed_good: number
  packed_defect: number
  entries: ShipmentPackingEntry[]
}

export function getLinePacking(docId: string, lineId: string, signal?: AbortSignal) {
  return request<ShipmentPackingResponse>(`/shipments/${docId}/lines/${lineId}/packing`, { signal })
}

// Отмена ошибочной записи компенсирующим движением (внести верную можно заново).
export function reversePackingEntry(docId: string, lineId: string, entryId: string, requestId?: string) {
  return request<{ message: string; packed_good: number; packed_defect: number }>(
    `/shipments/${docId}/lines/${lineId}/packing/${entryId}/reverse`,
    { method: 'POST', headers: requestIdHeaders(requestId) },
  )
}

// --- Labels ---
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft: 'Черновик',
  packing: 'В плане',
  on_packing: 'На упаковке',
  relocating: 'Перемещение',
  awaiting_trip: 'Ожидает рейс',
  partially_shipped: 'Частично отгружено',
  shipped: 'Отгружено',
  completed_no_goods: 'Завершён',
  cancelled: 'Аннулирован',
}
