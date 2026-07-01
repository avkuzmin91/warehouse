import { request } from './http'
import { moscowTodayYmd } from '../utils/format'
import type { TripAllocBreakdownItem } from './tripsApi'
import type { DuplicateCheckResponse } from './domainTypes'

// --- Types ---

export type ReceiptStatus =
  | 'draft'
  | 'planned'
  | 'on_intake'
  | 'partially_received'
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
  trips: TripRef[]
  created_at: string
  created_by: string | null
  updated_at: string | null
}

export type TripRef = { id: string; number: string }

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
  planned_qty: number
  accepted_qty: number | null
  /** Сколько уже привезли разгруженные рейсы — потолок приёмки в карточке (ручное поступление = план). */
  arrived_qty: number
  /** Фактическая раскладка принятого по ячейкам (из журнала). Пусто, пока не принято. */
  placements: ReceiptLinePlacement[]
  created_at: string
}

export type ReceiptLinePlacement = {
  storage_zone_id: string | null
  storage_zone_name: string | null
  qty: number
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
  sku_count: number
}

export type ReceiptDetail = {
  doc: ReceiptDoc
  lines: ReceiptLine[]
  ops: ReceiptOp[]
  state: ReceiptState
  /** Приёмка рейсами завершилась недопоставкой — менеджер может закрыть с недопоставкой. */
  can_close_short: boolean
}

export type ReceiptListItem = ReceiptDoc & {
  sku_count: number
  total_planned: number
  total_accepted_qty: number
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
}

export type ReceiptListParams = {
  page?: number
  limit?: number
  client_id?: string
  status?: ReceiptStatus | ReceiptStatus[]
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
  if (params.status) sp.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status)
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
  if (params.status) sp.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status)
  if (params.overdue) sp.set('overdue', 'true')
  if (params.search) sp.set('search', params.search)
  if (params.sku) sp.set('sku', params.sku)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<ReceiptLinesResponse>(`/receipts/lines${q ? `?${q}` : ''}`, { signal })
}

export function getReceipt(docId: string) {
  return request<ReceiptDetail>(`/receipts/${docId}`)
}

export type ReceiptTripRemainingLine = {
  line_id: string
  product_sku: string | null
  product_name: string | null
  color: string | null
  variant: string | null
  planned_qty: number
  accepted_qty: number
  remaining: number
  /** В какие активные рейсы уже распределена строка (объясняет «распределено»). */
  allocations: TripAllocBreakdownItem[]
}

/** Остаток к распределению по строкам поступления для привязки к рейсу. */
export function getReceiptTripRemaining(docId: string, signal?: AbortSignal) {
  return request<{ lines: ReceiptTripRemainingLine[] }>(`/receipts/${docId}/trip-alloc-remaining`, { signal })
}

export function createReceipt(payload: ReceiptCreatePayload) {
  return request<{ message: string }>('/receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
    idempotent: true,
  })
}

export type ReceiptDuplicateCheckPayload = {
  client_id: string
  arrival_date?: string | null
  lines: { product_id: string; color_id?: string | null; size_id?: string | null; planned_qty: number }[]
}

/** Ищет сегодняшние поступления клиента с тем же составом — предупреждение о дубле. */
export function checkReceiptDuplicate(payload: ReceiptDuplicateCheckPayload, signal?: AbortSignal) {
  return request<DuplicateCheckResponse>('/receipts/check-duplicate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
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

// QC поступления удалён: годность/брак определяются при упаковке отгрузки.

export function advanceReceiptStatus(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}/advance`, {
    method: 'POST',
  })
}

// Карточная приёмка (/intake, /arrive) удалена: поступления принимаются в рейсе
// (разгрузка рейса), историческое заведение — действие в «Остатках».

export function cancelReceipt(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}/cancel`, {
    method: 'POST',
  })
}

/** Частично принято → Завершён: закрыть поступление с недопоставкой (менеджер). */
export function closeReceiptShort(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}/close-short`, {
    method: 'POST',
  })
}

/** Частично принято: освободить недовоз разгруженных рейсов под новый рейс (менеджер). */
export function expectRedelivery(docId: string) {
  return request<{ message: string }>(`/receipts/${docId}/expect-redelivery`, {
    method: 'POST',
  })
}

/** Корректировка обсчёта приёмки по строке (менеджер / начальник склада): новое
 *  принятое + причина. Правит сток и пишет в журнал. */
export function correctReceivedQty(docId: string, lineId: string, payload: { accepted_qty: number; reason: string }) {
  return request<{ message: string }>(`/receipts/${docId}/lines/${lineId}/correct-received`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// --- Labels & helpers ---

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  draft: 'Создание',
  planned: 'В плане',
  on_intake: 'На приёмке',
  partially_received: 'Частично принято',
  on_review: 'На проверке',
  done: 'Завершён',
  cancelled: 'Аннулирован',
}

export const RECEIPT_STEP_DONE_LABELS: Record<ReceiptStatus, string> = {
  draft: 'Создан',
  planned: 'Запланирован',
  on_intake: 'Принят',
  partially_received: 'Принято рейсом',
  on_review: 'Проверен',
  done: 'Завершён',
  cancelled: 'Аннулирован',
}

// Один линейный путь поступления: приёмка идёт рейсом, поэтому маршрут —
// Создание → В плане → Частично принято → Завершён. on_intake/on_review — легаси,
// в маршрут не входят (старые документы отображаются корректно).
export const RECEIPT_STATUS_ORDER: ReceiptStatus[] = [
  'draft', 'planned', 'partially_received', 'done',
]

/** Статусы поступлений, доступные для привязки к рейсу: «В плане» и «Частично принято»
 *  (остаток можно довезти следующими рейсами). */
export const RECEIPT_TRIP_SELECTABLE_STATUSES: ReceiptStatus[] = ['planned', 'partially_received']

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
    partially_received: 'warning',
    on_review: 'warning',
    done: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}

export function receiptQcStatus(item: ReceiptListItem): { label: string; tone: string } {
  if (item.status === 'done') return { label: 'Принято', tone: 'success' }
  if (item.status === 'on_intake') return { label: 'Приёмка', tone: 'warning' }
  return { label: 'Не начата', tone: '' }
}

export function isReceiptOverdue(item: ReceiptListItem): boolean {
  if (item.status === 'done' || item.status === 'cancelled') return false
  if (!item.arrival_date) return false
  return item.arrival_date < moscowTodayYmd()
}
