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
}

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

export function getReceipts(params: ReceiptListParams = {}, signal?: AbortSignal): Promise<ReceiptListResponse> {
  const sp = new URLSearchParams()
  if (params.page)      sp.set('page', String(params.page))
  if (params.limit)     sp.set('limit', String(params.limit))
  if (params.status)    sp.set('status', params.status)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
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
