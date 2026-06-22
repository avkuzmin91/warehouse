import { request } from './http'

export type DispatchStatus = 'draft' | 'awaiting_trip' | 'partially_shipped' | 'shipped' | 'cancelled'

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  draft:             'Создание',
  awaiting_trip:     'Ожидает рейс',
  partially_shipped: 'Частично отгружено',
  shipped:           'Отгружено',
  cancelled:         'Аннулирована',
}

export const DISPATCH_STATUS_TONES: Record<DispatchStatus, string> = {
  draft:             '',
  awaiting_trip:     'warning',
  partially_shipped: 'warning',
  shipped:           'success',
  cancelled:         'danger',
}

export const DISPATCH_STATUS_ORDER: DispatchStatus[] = [
  'draft', 'awaiting_trip', 'partially_shipped', 'shipped',
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
  'awaiting_trip', 'partially_shipped',
]

export type DispatchCargoType = 'good' | 'defect'

export type DispatchOpType =
  | 'doc_create' | 'doc_update' | 'priority_update'
  | 'line_add' | 'line_update' | 'line_delete' | 'advance' | 'ship' | 'cancel'

export type DispatchOp = {
  id:               string
  op_type:          DispatchOpType
  comment:          string | null
  created_at:       string
  created_by:       string | null
  created_by_email: string | null
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
  site_url:     string | null
  store_id:     string | null
  store_name:   string | null
  /** Остаток к распределению в рейс (план − отгружено − активные рейсы, по факту ready). */
  remaining:    number
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
  trips:            { id: string; number: string }[]
  created_at:       string
  created_by:       string | null
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
  all:      number
  draft:    number
  awaiting: number
  shipped:  number
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
  qty?:        number
  site_url?:   string | null
  store_id?:   string | null
  store_name?: string | null
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
}

/** Остаток к распределению по строкам отгрузки для привязки к рейсу. */
export function getDispatchTripRemaining(id: string, signal?: AbortSignal) {
  return request<{ lines: DispatchTripRemainingLine[] }>(`/dispatches/${id}/trip-alloc-remaining`, { signal })
}

export function createDispatch(body: DispatchDocCreate) {
  return request<{ message: string }>('/dispatches', { method: 'POST', body: JSON.stringify(body) })
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

export function deleteDispatchLine(docId: string, lineId: string) {
  return request<{ message: string }>(`/dispatches/${docId}/lines/${lineId}`, { method: 'DELETE' })
}

export function advanceDispatch(id: string) {
  return request<{ message: string }>(`/dispatches/${id}/advance`, { method: 'POST' })
}

export function cancelDispatch(id: string) {
  return request<{ message: string }>(`/dispatches/${id}/cancel`, { method: 'POST' })
}
