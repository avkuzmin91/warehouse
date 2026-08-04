import { request, requestForm } from './http'
import type { TripAllocBreakdownItem } from './tripsApi'
import type { DuplicateCheckResponse } from './domainTypes'

export type DispatchStatus = 'draft' | 'awaiting_packing' | 'preparing' | 'awaiting_trip' | 'partially_shipped' | 'shipped' | 'cancelled'

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  draft:             'Создание',
  awaiting_packing:  'Ожидание упаковки',
  preparing:         'Подготовка отгрузки',
  awaiting_trip:     'Ожидает рейс',
  partially_shipped: 'Частично отгружено',
  shipped:           'Отгружено',
  cancelled:         'Аннулирована',
}

export const DISPATCH_STATUS_TONES: Record<DispatchStatus, string> = {
  draft:             '',
  awaiting_packing:  'info',
  preparing:         'info',
  awaiting_trip:     'warning',
  partially_shipped: 'warning',
  shipped:           'success',
  cancelled:         'danger',
}

export const DISPATCH_STATUS_ORDER: DispatchStatus[] = [
  'draft', 'awaiting_packing', 'preparing', 'awaiting_trip', 'partially_shipped', 'shipped',
]

// Приоритет — уровень срочности: 1 «Срочно», 2 «Повышенный», null «Обычный».
export const DISPATCH_PRIORITY_URGENT = 1
export const DISPATCH_PRIORITY_HIGH   = 2

export const DISPATCH_PRIORITY_LABELS: Record<number, string> = {
  [DISPATCH_PRIORITY_URGENT]: 'Срочно',
  [DISPATCH_PRIORITY_HIGH]:   'Повышенный',
}

export function dispatchPriorityLabel(rank: number | null): string {
  return (rank != null && DISPATCH_PRIORITY_LABELS[rank]) || 'Обычный'
}

export function dispatchPriorityTone(rank: number | null): 'danger' | 'warning' | '' {
  if (rank === DISPATCH_PRIORITY_URGENT) return 'danger'
  if (rank === DISPATCH_PRIORITY_HIGH) return 'warning'
  return ''
}

/** Статусы отгрузок, доступные логисту для привязки к рейсу (есть готовый остаток). */
export const DISPATCH_TRIP_SELECTABLE_STATUSES: DispatchStatus[] = [
  'preparing', 'awaiting_trip', 'partially_shipped',
]

export type DispatchCargoType = 'good' | 'good_unpacked' | 'defect'

/** Тип груза отгрузки: годный (через упаковку), годный без упаковки (со хранения), брак. */
export const DISPATCH_CARGO_LABELS: Record<DispatchCargoType, string> = {
  good:          'Товар',
  good_unpacked: 'Без упаковки',
  defect:        'Брак',
}

export type DispatchOpType =
  | 'doc_create' | 'doc_update' | 'priority_update'
  | 'line_add' | 'line_update' | 'line_delete' | 'advance' | 'prepare' | 'ship' | 'cancel'

export type DispatchOp = {
  id:               string
  op_type:          DispatchOpType
  comment:          string | null
  created_at:       string
  created_by:       string | null
  created_by_email: string | null
}

export type DispatchLineFile = {
  id:         string
  filename:   string
  url:        string
  mime_type:  string | null
  created_at: string
}

export type DispatchLine = {
  id:           string
  product_id:   string
  product_name: string
  product_sku:  string
  sku_pending:  boolean
  color_id:     string | null
  color_name:   string | null
  size_id:      string | null
  size_name:    string | null
  qty:          number
  shipped_qty:  number
  /** Количество палет в строке (вводит менеджер; обязательно перед передачей в подготовку). */
  pallets_qty:  number | null
  /** Количество коробов в строке (вводит менеджер; обязательно перед передачей в подготовку). */
  boxes_qty:    number | null
  /** Кратность товара на короб из карточки товара — для рекомендации числа коробов. */
  items_per_box: number | null
  /** Кратность «коробов на палете» из карточки товара — для рекомендации числа палет. */
  boxes_per_pallet: number | null
  site_url:     string | null
  store_id:     string | null
  store_name:   string | null
  /** Остаток к распределению в рейс (план − отгружено − активные рейсы, по факту ready). */
  remaining:    number
  /** Вложения по строке (zip/pdf/jpeg), которые менеджер прикрепил для склада. */
  files:        DispatchLineFile[]
}

export type DispatchListItem = {
  id:                string
  doc_number:        string
  cargo_type:        DispatchCargoType
  client_id:         string | null
  client_name:       string | null
  destination:       string | null
  carrier:           string | null
  logistics_cost:    number | null
  ship_date:         string | null
  priority_rank:     number | null
  status:            DispatchStatus
  status_label:      string
  sku_count:         number
  total_qty:         number
  total_shipped_qty: number
  created_at:        string
}

export type DispatchDetail = {
  id:               string
  doc_number:       string
  cargo_type:       DispatchCargoType
  client_id:        string | null
  client_name:      string | null
  destination:      string | null
  carrier:          string | null
  logistics_cost:   number | null
  ship_date:        string | null
  priority_rank:    number | null
  actual_ship_date: string | null
  comment:          string | null
  status:           DispatchStatus
  status_label:     string
  /** По отгрузке выставлен счёт (issued+) — палеты править нельзя. */
  invoiced:         boolean
  trips:            { id: string; number: string }[]
  created_at:       string
  created_by:       string | null
  created_by_name:  string | null
  updated_at:       string | null
  lines:            DispatchLine[]
  ops:              DispatchOp[]
  sku_count:        number
  total_qty:        number
}

export type DispatchListResponse = {
  items: DispatchListItem[]
  total: number
  page:  number
  limit: number
}

export type DispatchLinesListItem = {
  line_id:      string
  doc_id:       string
  doc_number:   string
  cargo_type:   DispatchCargoType
  client_id:    string | null
  client_name:  string | null
  destination:  string | null
  ship_date:    string | null
  status:       DispatchStatus
  status_label: string
  product_id:   string
  product_name: string
  product_sku:  string
  color_name:   string | null
  size_name:    string | null
  qty:          number
  shipped_qty:  number
  store_name:   string | null
}

export type DispatchLinesResponse = {
  items: DispatchLinesListItem[]
  total: number
  page:  number
  limit: number
}

export type DispatchListParams = {
  page?:       number
  limit?:      number
  status?:     DispatchStatus | DispatchStatus[]
  client_id?:  string
  search?:     string
  sku?:        string
  date_from?:  string
  date_to?:    string
  cargo_type?: DispatchCargoType
  /** Кандидаты на привязку к рейсу: исключает отгрузки, привязанные к этому рейсу. */
  available_for_trip_id?: string
}

export type DispatchSummary = {
  all:              number
  draft:            number
  awaiting_packing: number
  preparing:        number
  awaiting:         number
  shipped:          number
}

export type DispatchLineIn = {
  product_id:   string
  product_name: string
  product_sku:  string
  color_id?:    string | null
  color_name?:  string | null
  size_id?:     string | null
  size_name?:   string | null
  qty:          number
  pallets_qty?: number | null
  boxes_qty?:   number | null
  site_url?:    string | null
  store_id?:    string | null
  store_name?:  string | null
}

export type DispatchDocCreate = {
  cargo_type?:     DispatchCargoType
  client_id?:      string | null
  client_name?:    string | null
  destination?:    string | null
  carrier?:        string | null
  logistics_cost?: number | null
  ship_date?:      string | null
  comment?:        string | null
  lines?:          DispatchLineIn[]
}

export type DispatchDocUpdate = {
  cargo_type?:      DispatchCargoType
  client_id?:       string | null
  client_name?:     string | null
  destination?:     string | null
  carrier?:         string | null
  logistics_cost?:  number | null
  ship_date?:       string | null
  comment?:         string | null
  priority_rank?:   number | null
  actual_ship_date?: string | null
}

export type DispatchLineUpdate = {
  qty?:         number
  pallets_qty?: number | null
  boxes_qty?:   number | null
  site_url?:    string | null
  store_id?:    string | null
  store_name?:  string | null
}

/** Рекомендованное число коробов: количество штук делится на «штук в коробе» вверх.
 *  null — кратность не задана в карточке товара (менеджер вводит вручную). */
export function recommendedBoxes(qty: number, itemsPerBox: number | null | undefined): number | null {
  if (!itemsPerBox || itemsPerBox <= 0) return null
  return Math.max(1, Math.ceil(qty / itemsPerBox))
}

/** Рекомендованное число палет: число коробов делится на «коробов на палете» вверх.
 *  Палета меряется в коробах, а не в штуках. null — кратность не задана либо коробов нет
 *  (менеджер вводит вручную). */
export function recommendedPallets(boxes: number | null | undefined, boxesPerPallet: number | null | undefined): number | null {
  if (!boxesPerPallet || boxesPerPallet <= 0) return null
  if (!boxes || boxes <= 0) return null
  return Math.max(1, Math.ceil(boxes / boxesPerPallet))
}

function buildListQuery(params: DispatchListParams): string {
  const sp = new URLSearchParams()
  if (params.page)       sp.set('page', String(params.page))
  if (params.limit)      sp.set('limit', String(params.limit))
  if (params.status)     sp.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status)
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.sku)        sp.set('sku', params.sku)
  if (params.date_from)  sp.set('date_from', params.date_from)
  if (params.date_to)    sp.set('date_to', params.date_to)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  if (params.available_for_trip_id) sp.set('available_for_trip_id', params.available_for_trip_id)
  const q = sp.toString()
  return q ? `?${q}` : ''
}

export function listDispatches(params: DispatchListParams = {}, signal?: AbortSignal) {
  return request<DispatchListResponse>(`/dispatches${buildListQuery(params)}`, { signal })
}

export function listDispatchLines(params: DispatchListParams = {}, signal?: AbortSignal) {
  return request<DispatchLinesResponse>(`/dispatches/lines${buildListQuery(params)}`, { signal })
}

export function getDispatchesSummary(
  params: Pick<DispatchListParams, 'client_id' | 'search' | 'sku' | 'date_from' | 'date_to' | 'cargo_type'> = {},
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.sku)        sp.set('sku', params.sku)
  if (params.date_from)  sp.set('date_from', params.date_from)
  if (params.date_to)    sp.set('date_to', params.date_to)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  const q = sp.toString()
  return request<DispatchSummary>(`/dispatches/summary${q ? `?${q}` : ''}`, { signal })
}

export function getDispatch(id: string) {
  return request<DispatchDetail>(`/dispatches/${id}`)
}

export type DispatchTripRemainingLine = {
  line_id:      string
  product_sku:  string | null
  product_name: string | null
  color:        string | null
  variant:      string | null
  qty:          number
  shipped_qty:  number
  remaining:    number
  /** В какие активные рейсы уже распределена строка (объясняет «распределено»). */
  allocations:  TripAllocBreakdownItem[]
}

/** Остаток к распределению по строкам отгрузки для привязки к рейсу. */
export function getDispatchTripRemaining(id: string, signal?: AbortSignal) {
  return request<{ lines: DispatchTripRemainingLine[] }>(`/dispatches/${id}/trip-alloc-remaining`, { signal })
}

/** Зарезервированный к отгрузке остаток по варианту (уже обещан незакрытым отгрузкам). */
export type DispatchReservation = {
  product_id: string
  color_id:   string | null
  size_id:    string | null
  reserved:   number
}

/** Резервы по вариантам для клиента/типа груза — чтобы витрина подбора показывала
 *  свободный, а не валовой остаток (тот же резерв вычитает серверный гейт). */
export function getDispatchReservations(
  params: { client_id?: string; cargo_type?: DispatchCargoType } = {},
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  const q = sp.toString()
  return request<{ items: DispatchReservation[] }>(`/dispatches/reservations${q ? `?${q}` : ''}`, { signal })
}

export function createDispatch(body: DispatchDocCreate) {
  return request<{ message: string }>('/dispatches', { method: 'POST', body: JSON.stringify(body), idempotent: true })
}

export type DispatchDuplicateCheckPayload = {
  cargo_type: DispatchCargoType
  client_id?: string | null
  ship_date?: string | null
  lines: { product_id: string; color_id?: string | null; size_id?: string | null; qty: number }[]
}

/** Ищет сегодняшние отгрузки клиента того же типа с тем же составом — предупреждение о дубле. */
export function checkDispatchDuplicate(payload: DispatchDuplicateCheckPayload, signal?: AbortSignal) {
  return request<DuplicateCheckResponse>('/dispatches/check-duplicate', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function updateDispatch(id: string, body: DispatchDocUpdate) {
  return request<{ message: string }>(`/dispatches/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function updateDispatchPriority(id: string, priorityRank: number | null) {
  return request<{ message: string }>(`/dispatches/${id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority_rank: priorityRank }),
  })
}

export function addDispatchLine(docId: string, line: DispatchLineIn) {
  return request<{ message: string }>(`/dispatches/${docId}/lines`, { method: 'POST', body: JSON.stringify(line) })
}

export function updateDispatchLine(docId: string, lineId: string, body: DispatchLineUpdate) {
  return request<{ message: string }>(`/dispatches/${docId}/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(body) })
}

/** Правка числа палет по строке на любом статусе (кроме аннулированной/выставленной счётом). */
export function updateDispatchLinePallets(docId: string, lineId: string, palletsQty: number | null) {
  return request<{ message: string }>(`/dispatches/${docId}/lines/${lineId}/pallets`, {
    method: 'PATCH',
    body: JSON.stringify({ pallets_qty: palletsQty }),
  })
}

/** Правка числа коробов по строке на любом статусе (кроме аннулированной/выставленной счётом). */
export function updateDispatchLineBoxes(docId: string, lineId: string, boxesQty: number | null) {
  return request<{ message: string }>(`/dispatches/${docId}/lines/${lineId}/boxes`, {
    method: 'PATCH',
    body: JSON.stringify({ boxes_qty: boxesQty }),
  })
}

export function deleteDispatchLine(docId: string, lineId: string) {
  return request<{ message: string }>(`/dispatches/${docId}/lines/${lineId}`, { method: 'DELETE' })
}

export function uploadDispatchLineFile(docId: string, lineId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return requestForm<{ message: string }>(`/dispatches/${docId}/lines/${lineId}/files`, {
    method: 'POST',
    body: form,
  })
}

export function deleteDispatchLineFile(docId: string, lineId: string, fileId: string) {
  return request<{ message: string }>(`/dispatches/${docId}/lines/${lineId}/files/${fileId}`, {
    method: 'DELETE',
  })
}

export function advanceDispatch(id: string) {
  return request<{ message: string }>(`/dispatches/${id}/advance`, { method: 'POST' })
}

export type DispatchPrepareSource = { zone_id: string; zone_name: string | null; qty: number }
export type DispatchPrepareLine = { line_id: string; sources: DispatchPrepareSource[] }

export function finishDispatchPreparation(id: string, lines: DispatchPrepareLine[]) {
  return request<{ message: string }>(`/dispatches/${id}/finish-preparation`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
  })
}

export function cancelDispatch(id: string) {
  return request<{ message: string }>(`/dispatches/${id}/cancel`, { method: 'POST' })
}

// Возврат на корректировку (→ черновик) до выезда первого рейса; из «Ожидает рейс»
// бэк сторнирует подготовку. Блокируется распределением в активный рейс.
export function returnDispatchToDraft(id: string, reason?: string) {
  return request<{ message: string }>(`/dispatches/${id}/return-to-draft`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? null }),
  })
}
