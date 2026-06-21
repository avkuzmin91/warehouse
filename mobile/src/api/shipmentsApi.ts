import { request, requestIdHeaders } from './http'

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
