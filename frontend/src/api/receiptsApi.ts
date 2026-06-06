import { request } from './http'

// --- Types ---

export type ReceiptStatus =
  | 'draft'
  | 'planned'
  | 'on_intake'
  | 'on_review'
  | 'done'
  | 'cancelled'

export type ReceiptOpType =
  | 'doc_create'
  | 'doc_update'
  | 'line_add'
  | 'line_update'
  | 'plan_fix'
  | 'intake_start'
  | 'arrival_fix'
  | 'arrival_accept'
  | 'receiving'
  | 'defect_fix'
  | 'qc_complete'
  | 'cancel'
  | 'line_delete'
  | 'line_qc_complete'
  | 'line_qc_reopen'
  | 'receiving_correction'
  | 'defect_correction'

export type ReceiptQcStatus = 'pending' | 'in_progress' | 'done'

export type ReceiptDoc = {
  id: string
  doc_number: string
  client_id: string
  client_name: string | null
  supplier_name: string | null
  arrival_date: string | null
  actual_arrival_date: string | null
  comment: string | null
  status: ReceiptStatus
  zone_id: string | null
  zone_name: string | null
  ttn: string | null
  logistics_cost: number | null
  trip_id: string | null
  trip_number: string | null
  created_at: string
  created_by: string | null
  updated_at: string | null
}

export type ReceiptLine = {
  id: string
  doc_id: string
  product_id: string
  product_name: string
  product_sku: string
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  storage_zone_id: string | null
  storage_zone_name: string | null
  good_zone_id: string | null
  good_zone_name: string | null
  defect_zone_id: string | null
  defect_zone_name: string | null
  planned_qty: number
  accepted_qty: number | null
  accepted: number
  defect: number
  ops_count: number
  qc_status: ReceiptQcStatus
  created_at: string
}

export type ReceiptOp = {
  id: string
  doc_id: string
  line_id: string | null
  op_type: ReceiptOpType
  qty: number | null
  reason: string | null
  comment: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
}

export type ReceiptState = {
  lines: ReceiptLine[]
  total_planned: number
  total_accepted_qty: number
  total_accepted: number
  total_defect: number
  sku_count: number
  ops_count: number
}

export type ReceiptDetail = {
  doc: ReceiptDoc
  lines: ReceiptLine[]
  ops: ReceiptOp[]
  state: ReceiptState
}

export type ReceiptListItem = ReceiptDoc & {
  sku_count: number
  total_planned: number
  total_accepted_qty: number
  total_accepted: number
  total_defect: number
}

export type ReceiptListResponse = {
  items: ReceiptListItem[]
  total: number
  page: number
  limit: number
}

export type ReceiptLinesListItem = {
  line_id: string
  doc_id: string
  doc_number: string
  client_id: string
  client_name: string | null
  arrival_date: string | null
  actual_arrival_date: string | null
  status: ReceiptStatus
  product_id: string
  product_name: string
  product_sku: string
  color_name: string | null
  size_name: string | null
  planned_qty: number
  accepted_qty: number | null
  storage_zone_name: string | null
}

export type ReceiptLinesResponse = {
  items: ReceiptLinesListItem[]
  total: number
  page: number
  limit: number
}

export type ReceiptLineInput = {
  product_id: string
  product_name: string
  product_sku: string
  color_id?: string | null
  color_name?: string | null
  size_id?: string | null
  size_name?: string | null
  storage_zone_id?: string | null
  storage_zone_name?: string | null
  planned_qty: number
}

export type ReceiptCreatePayload = {
  client_id: string
  supplier_name?: string | null
  arrival_date?: string | null
  comment?: string | null
  zone_id?: string | null
  zone_name?: string | null
  ttn?: string | null
  logistics_cost?: number | null
  lines: ReceiptLineInput[]
}

export type ReceiptUpdatePayload = {
  client_id?: string
  supplier_name?: string | null
  arrival_date?: string | null
  comment?: string | null
  zone_id?: string | null
  zone_name?: string | null
  ttn?: string | null
  logistics_cost?: number | null
}

export type ReceiptLineUpdatePayload = {
  planned_qty?: number
  accepted_qty?: number
  storage_zone_id?: string | null
  storage_zone_name?: string | null
  good_zone_id?: string | null
  good_zone_name?: string | null
  defect_zone_id?: string | null
  defect_zone_name?: string | null
}

export type ReceiptListParams = {
  page?: number
  limit?: number
  client_id?: string
  status?: ReceiptStatus
  overdue?: boolean
  search?: string
  sku?: string
  date_from?: string
  date_to?: string
  unlinked_to_trip?: boolean
  available_for_trip_id?: string
}

// --- API functions ---

export type ReceiptsSummary = {
  all: number
  active: number
  done: number
  drafts: number
  overdue: number
}

export function getReceiptsSummary(params: Pick<ReceiptListParams, 'client_id' | 'search' | 'sku' | 'date_from' | 'date_to'> = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.sku) sp.set('sku', params.sku)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<ReceiptsSummary>(`/receipts/summary${q ? `?${q}` : ''}`, { signal })
}

export function getReceipts(params: ReceiptListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.status) sp.set('status', params.status)
  if (params.overdue) sp.set('overdue', 'true')
  if (params.search) sp.set('search', params.search)
  if (params.sku) sp.set('sku', params.sku)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  if (params.unlinked_to_trip) sp.set('unlinked_to_trip', 'true')
  if (params.available_for_trip_id) sp.set('available_for_trip_id', params.available_for_trip_id)
  const q = sp.toString()
  return request<ReceiptListResponse>(`/receipts${q ? `?${q}` : ''}`, { signal })
}

export function getReceiptLines(params: ReceiptListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.status) sp.set('status', params.status)
  if (params.overdue) sp.set('overdue', 'true')
  if (params.search) sp.set('search', params.search)
  if (params.sku) sp.set('sku', params.sku)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<ReceiptLinesResponse>(`/receipts/lines${q ? `?${q}` : ''}`, { signal })
}

function normalizeReceiptQcStatus(status: string): ReceiptQcStatus {
  return status === 'completed' ? 'done' : (status as ReceiptQcStatus)
}

function normalizeReceiptDetail(detail: ReceiptDetail): ReceiptDetail {
  return {
    ...detail,
    lines: detail.lines.map((line) => ({
      ...line,
      qc_status: normalizeReceiptQcStatus(line.qc_status),
    })),
    state: {
      ...detail.state,
      lines: detail.state.lines.map((line) => ({
        ...line,
        qc_status: normalizeReceiptQcStatus(line.qc_status),
      })),
    },
  }
}

export async function getReceipt(docId: string) {
  const detail = await request<ReceiptDetail>(`/receipts/${docId}`)
  return normalizeReceiptDetail(detail)
}

export function createReceipt(payload: ReceiptCreatePayload) {
  return request<{ message: string }>('/receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateReceipt(docId: string, payload: ReceiptUpdatePayload) {
  return request<{ message: string }>(`/receipts/${docId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function updateReceiptActualArrival(docId: string, actual_arrival_date: string | null) {
  return request<{ message: string }>(`/receipts/${docId}/actual-arrival`, {
    method: 'PATCH',
    body: JSON.stringify({ actual_arrival_date }),
  })
}

export function addReceiptLine(docId: string, payload: ReceiptLineInput) {
  return request<{ message: string }>(`/receipts/${docId}/lines`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteReceipt(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}`, { method: 'DELETE' })
}

export function updateReceiptLine(docId: string, lineId: string, payload: number | ReceiptLineUpdatePayload) {
  const body = typeof payload === 'number' ? { planned_qty: payload } : payload
  return request<{ message: string }>(`/receipts/${docId}/lines/${lineId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deleteReceiptLine(docId: string, lineId: string) {
  return request<{ message: string }>(`/receipts/${docId}/lines/${lineId}`, {
    method: 'DELETE',
  })
}

export function recordReceiptOp(
  docId: string,
  payload: {
    line_id: string
    op_type: 'receiving' | 'defect_fix' | 'receiving_correction' | 'defect_correction'
    qty: number
    reason?: string | null
    comment?: string | null
  },
) {
  return request<{ message: string }>(`/receipts/${docId}/ops`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function completeReceiptLine(
  docId: string,
  lineId: string,
  targets?: { accepted: number; defect: number },
) {
  return request<{ message: string }>(`/receipts/${docId}/lines/${lineId}/qc-complete`, {
    method: 'POST',
    body: targets ? JSON.stringify(targets) : undefined,
  })
}

export function reopenReceiptLine(docId: string, lineId: string) {
  return request<{ message: string }>(`/receipts/${docId}/lines/${lineId}/qc-reopen`, {
    method: 'POST',
  })
}

export function advanceReceiptStatus(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}/advance`, {
    method: 'POST',
  })
}

export function startReceiptIntake(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}/intake`, {
    method: 'POST',
  })
}

export type ReceiptArriveLine = { line_id: string; accepted_qty: number }

export function arriveReceipt(docId: string, lines: ReceiptArriveLine[]) {
  return request<{ message: string }>(`/receipts/${docId}/arrive`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
  })
}

export function cancelReceipt(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}/cancel`, {
    method: 'POST',
  })
}

export function reopenReceipt(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}/reopen`, {
    method: 'POST',
  })
}

// --- Labels & helpers ---

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  draft: 'Создание',
  planned: 'В плане',
  on_intake: 'На приемке',
  on_review: 'На проверке',
  done: 'Завершён',
  cancelled: 'Аннулирован',
}

export const RECEIPT_STEP_DONE_LABELS: Record<ReceiptStatus, string> = {
  draft: 'Создан',
  planned: 'Поступил',
  on_intake: 'Принят',
  on_review: 'Проверен',
  done: 'Завершен',
  cancelled: 'Аннулирован',
}

export const RECEIPT_STATUS_ORDER: ReceiptStatus[] = [
  'draft', 'planned', 'on_intake', 'on_review', 'done',
]

export const RECEIPT_OP_LABELS: Record<ReceiptOpType, string> = {
  doc_create: 'Создание документа',
  doc_update: 'Изменение документа',
  line_add: 'Добавление строки',
  line_update: 'Изменение строки',
  plan_fix: 'Запланировано поступление',
  intake_start: 'Начало приёмки',
  arrival_fix: 'Фиксация прибытия',
  arrival_accept: 'Принят при прибытии',
  receiving: 'Приёмка товара',
  defect_fix: 'Фиксация брака',
  qc_complete: 'Завершение проверки',
  cancel: 'Аннулирование',
  line_delete: 'Удаление товара',
  line_qc_complete: 'Товар проверен',
  line_qc_reopen: 'Начата корректировка',
  receiving_correction: 'Корректировка принятых',
  defect_correction: 'Корректировка брака',
}

export function receiptStatusTone(status: ReceiptStatus) {
  const map: Record<ReceiptStatus, string> = {
    draft: '',
    planned: 'info',
    on_intake: 'warning',
    on_review: 'warning',
    done: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}

export function receiptQcStatus(item: ReceiptListItem): { label: string; tone: string } {
  if (item.status === 'done') return { label: 'Завершена', tone: 'success' }
  if (item.status === 'on_review') return { label: 'В процессе', tone: 'warning' }
  if (item.total_defect > 0) return { label: 'Есть брак', tone: 'danger' }
  if (item.total_accepted > 0) return { label: 'Частично', tone: 'info' }
  return { label: 'Не начата', tone: '' }
}

export function isReceiptOverdue(item: ReceiptListItem): boolean {
  if (item.status === 'done' || item.status === 'cancelled') return false
  if (!item.arrival_date) return false
  const today = new Date().toISOString().slice(0, 10)
  return item.arrival_date < today
}
