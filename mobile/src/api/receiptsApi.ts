import { request } from './http'

// --- Types --- (подмножество backend/modules/receipts/schemas.py)
export type ReceiptStatus =
  | 'draft'
  | 'planned'
  | 'on_intake'
  | 'partially_received'
  | 'on_review'
  | 'done'
  | 'cancelled'

export type ReceiptListItem = {
  id: string
  doc_number: string
  client_name: string | null
  arrival_date: string | null
  status: ReceiptStatus
  sku_count: number
  total_planned: number
  total_accepted_qty: number
}

export type ReceiptListResponse = { items: ReceiptListItem[]; total: number; page: number; limit: number }

export type ReceiptListParams = {
  page?: number
  limit?: number
  status?: string
  client_id?: string
  search?: string
  available_for_trip_id?: string
}

// Поступления, которые можно довезти рейсом: «В плане» + «Частично принято» (остаток
// вторым рейсом). Зеркало web RECEIPT_TRIP_SELECTABLE_STATUSES.
export const RECEIPT_TRIP_SELECTABLE_STATUSES = 'planned,partially_received'

// --- Types --- (состав поступления)
export type ReceiptLine = {
  id: string
  product_name: string | null
  product_sku: string | null
  color_name: string | null
  size_name: string | null
  planned_qty: number
  accepted_qty: number | null
}

type ReceiptDetailResponse = { lines: ReceiptLine[] }

// --- API functions ---
/** Состав поступления — для рейсов без построчной аллокации (legacy-привязка целиком). */
export function getReceiptLines(docId: string, signal?: AbortSignal): Promise<ReceiptLine[]> {
  return request<ReceiptDetailResponse>(`/receipts/${docId}`, { signal }).then((d) => d.lines)
}

// Полная деталка поступления (для менеджерского просмотра).
export type ReceiptDocFull = {
  id: string
  doc_number: string
  client_name: string | null
  status: ReceiptStatus
  arrival_date: string | null
  actual_arrival_date: string | null
  comment: string | null
  logistics_cost: number | null
}

export type ReceiptOp = {
  id: string
  op_type: string
  comment: string | null
  created_at: string
  created_by_email: string | null
}

export type ReceiptDetailFull = {
  doc: ReceiptDocFull
  lines: ReceiptLine[]
  ops: ReceiptOp[]
  can_close_short: boolean
}

export function getReceiptDetail(docId: string, signal?: AbortSignal): Promise<ReceiptDetailFull> {
  return request<ReceiptDetailFull>(`/receipts/${docId}`, { signal })
}

export type ReceiptLineInput = {
  product_id: string
  product_name: string
  product_sku: string
  color_id?: string | null
  color_name?: string | null
  size_id?: string | null
  size_name?: string | null
  planned_qty: number
}

export type ReceiptCreatePayload = {
  client_id: string
  arrival_date?: string | null
  comment?: string | null
  logistics_cost?: number | null
  lines: ReceiptLineInput[]
}

export function createReceipt(payload: ReceiptCreatePayload): Promise<{ message: string }> {
  return request<{ message: string }>('/receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function advanceReceiptStatus(docId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/receipts/${docId}/advance`, { method: 'POST' })
}

// Пост-фактум корректировка обсчёта приёмки по строке (частично принято / завершён):
// правит принятое вместе со стоком и журналом. Причина обязательна.
export function correctReceivedQty(docId: string, lineId: string, payload: { accepted_qty: number; reason: string }) {
  return request<{ message: string }>(`/receipts/${docId}/lines/${lineId}/correct-received`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// Аннулировать можно только «В плане» и без привязки к активному рейсу (гейты бэка).
export function cancelReceipt(docId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/receipts/${docId}/cancel`, { method: 'POST' })
}

/** Частично принято → Завершён: закрыть поступление с недопоставкой (менеджер). */
export function closeReceiptShort(docId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/receipts/${docId}/close-short`, { method: 'POST' })
}

/** Частично принято: освободить недовоз разгруженных рейсов под новый рейс (менеджер). */
export function expectRedelivery(docId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/receipts/${docId}/expect-redelivery`, { method: 'POST' })
}

export function getReceipts(params: ReceiptListParams = {}, signal?: AbortSignal): Promise<ReceiptListResponse> {
  const sp = new URLSearchParams()
  if (params.page)      sp.set('page', String(params.page))
  if (params.limit)     sp.set('limit', String(params.limit))
  if (params.status)    sp.set('status', params.status)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
  if (params.available_for_trip_id) sp.set('available_for_trip_id', params.available_for_trip_id)
  const q = sp.toString()
  return request<ReceiptListResponse>(`/receipts${q ? `?${q}` : ''}`, { signal })
}

// --- Labels ---
export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  draft: 'Создание',
  planned: 'В плане',
  on_intake: 'На приёмке',
  partially_received: 'Частично принято',
  on_review: 'На проверке',
  done: 'Завершён',
  cancelled: 'Аннулирован',
}

export function receiptStatusTone(status: ReceiptStatus): string {
  const map: Record<ReceiptStatus, string> = {
    draft: '',
    planned: 'info',
    on_intake: 'warning',
    partially_received: 'warning',
    on_review: 'warning',
    done: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}
