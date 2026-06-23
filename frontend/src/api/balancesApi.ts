import { request } from './http'

// --- Types ---

/** Операционный статус запаса: что товар делает. */
export type InvOpStatus = 'storage' | 'packing' | 'packed' | 'ready'
/** Качество запаса. «Не проверен» существует только внутри приёмки. */
export type InvQuality = 'good' | 'defect'

export const INV_OP_LABELS: Record<InvOpStatus, string> = {
  storage: 'На хранении',
  packing: 'На упаковке',
  packed:  'Упаковано',
  ready:   'Готов к отгрузке',
}

export const INV_QUALITY_LABELS: Record<InvQuality, string> = {
  good:   'Годный',
  defect: 'Брак',
}

/** Причина списания остатков (движение → written_off). */
export type WriteOffReason = 'shortage' | 'damage' | 'disposal' | 'client_return' | 'other'

export const WRITEOFF_REASON_LABELS: Record<WriteOffReason, string> = {
  shortage:      'Недостача',
  damage:        'Порча',
  disposal:      'Утилизация брака',
  client_return: 'Возврат клиенту',
  other:         'Прочее',
}

export type BalanceItem = {
  product_id: string
  product_name: string
  product_sku: string
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  client_id: string | null
  client_name: string | null
  storage_good: number
  storage_defect: number
  packing_good: number
  packing_defect: number
  packed_good: number
  packed_defect: number
  ready_good: number
  ready_defect: number
  total: number
  docs_count: number
}

/**
 * Позиция для планирования отгрузки: остаток на складе + товар в пути.
 * `in_transit` — заявленное, но ещё не приехавшее (planned − accepted по активным
 * поступлениям). Позицию можно положить в черновик, а перевести в план — только
 * когда товар появится на остатках (storage_good).
 */
export type PlannableItem = {
  product_id: string
  product_name: string
  product_sku: string
  sku_pending?: boolean
  client_id: string | null
  client_name: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  storage_good: number
  storage_defect: number
  in_transit: number
}

export type PlannableListResponse = {
  items: PlannableItem[]
}

export type PlannableParams = {
  client_id?:  string
  search?:     string
  cargo_type?: 'good' | 'defect'
  limit?:      number
}

export type BalanceSummary = {
  storage_good: number
  storage_defect: number
  packing_good: number
  packing_defect: number
  packed_good: number
  packed_defect: number
  ready_good: number
  ready_defect: number
  total: number
}

export type BalanceSummaryParams = {
  client_id?:  string
  search?:     string
  has_defect?: boolean
}

export type BalanceListParams = {
  page?: number
  limit?: number
  client_id?: string
  search?: string
  only_positive?: boolean
  has_defect?: boolean
}

export type BalanceListResponse = {
  items: BalanceItem[]
  total: number
  page: number
  limit: number
}

export type BalanceZoneItem = {
  location_id:   string | null
  location_name: string | null
  op_status:     InvOpStatus
  quality:       InvQuality
  product_id:    string
  product_name:  string
  product_sku:   string
  client_id:     string | null
  client_name:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  qty:           number
}

export type BalanceZonesParams = {
  client_id?:     string
  search?:        string
  location?:      string
  op_status?:     InvOpStatus
  quality?:       InvQuality
  page?:          number
  limit?:         number
  only_positive?: boolean
}

export type BalanceZonesResponse = {
  items: BalanceZoneItem[]
  /** Выборка обрезана серверным лимитом — список неполный (режим без пагинации). */
  truncated: boolean
  /** Число местоположений (страница = total/limit), заполняется при limit. */
  total: number
  page: number
  limit: number
}

// --- API functions ---

export function getBalances(params: BalanceListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.only_positive === false) sp.set('only_positive', 'false')
  if (params.has_defect) sp.set('has_defect', 'true')
  const q = sp.toString()
  return request<BalanceListResponse>(`/balances${q ? `?${q}` : ''}`, { signal })
}

export function getPlannableItems(params: PlannableParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  if (params.limit)      sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<PlannableListResponse>(`/balances/plannable${q ? `?${q}` : ''}`, { signal })
}

export function getBalancesSummary(params: BalanceSummaryParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.has_defect) sp.set('has_defect', 'true')
  const q = sp.toString()
  return request<BalanceSummary>(`/balances/summary${q ? `?${q}` : ''}`, { signal })
}

export function getBalancesByZone(params: BalanceZonesParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.location) sp.set('location', params.location)
  if (params.op_status) sp.set('op_status', params.op_status)
  if (params.quality) sp.set('quality', params.quality)
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.only_positive === false) sp.set('only_positive', 'false')
  const q = sp.toString()
  return request<BalanceZonesResponse>(`/balances/zones${q ? `?${q}` : ''}`, { signal })
}

export type ZoneRelocationPayload = {
  product_id:    string
  product_name:  string | null
  product_sku:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  client_id:     string | null
  client_name:   string | null
  quality:       InvQuality
  from_zone_id:  string | null
  to_zone_id:    string | null
  qty:           number
  comment?:      string | null
}

export function createZoneRelocation(payload: ZoneRelocationPayload) {
  return request<{ message: string }>('/balances/relocations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type WriteOffPayload = {
  product_id:    string
  product_name:  string | null
  product_sku:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  client_id:     string | null
  client_name:   string | null
  zone_id:       string
  quality:       InvQuality
  qty:           number
  reason:        WriteOffReason
  comment?:      string | null
}

export function createWriteOff(payload: WriteOffPayload) {
  return request<{ message: string }>('/balances/write-offs', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type QualityChangePayload = {
  product_id:    string
  product_name:  string | null
  product_sku:   string | null
  color_id:      string | null
  color_name:    string | null
  size_id:       string | null
  size_name:     string | null
  client_id:     string | null
  client_name:   string | null
  zone_id:       string
  from_quality:  InvQuality
  to_quality:    InvQuality
  qty:           number
  comment?:      string | null
}

export function createQualityChange(payload: QualityChangePayload) {
  return request<{ message: string }>('/balances/quality-changes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type StockEntryLine = {
  product_id:   string
  product_name: string
  product_sku:  string
  color_id:     string | null
  color_name:   string | null
  size_id:      string | null
  size_name:    string | null
  zone_id:      string
  quality:      InvQuality
  qty:          number
}

export type StockEntryPayload = {
  client_id: string
  comment?:  string | null
  lines:     StockEntryLine[]
}

/** Историческое заведение остатков (то, что лежало до системы) — без документа. */
export function createStockEntry(payload: StockEntryPayload) {
  return request<{ message: string }>('/balances/stock-entry', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type ZoneRelocationItem = {
  id:               string
  created_at:       string
  created_by_email: string | null
  from_op:          InvOpStatus | 'intake' | 'shipped' | 'written_off'
  to_op:            InvOpStatus | 'intake' | 'shipped' | 'written_off'
  from_quality:     InvQuality
  to_quality:       InvQuality
  product_name:     string | null
  product_sku:      string | null
  color_name:       string | null
  size_name:        string | null
  client_name:      string | null
  from_zone_name:   string | null
  to_zone_name:     string | null
  qty:              number
  reason:           string | null
  comment:          string | null
}

export type ZoneRelocationListParams = {
  page?:      number
  limit?:     number
  client_id?: string
  search?:    string
}

export type ZoneRelocationListResponse = {
  items: ZoneRelocationItem[]
  total: number
  page:  number
  limit: number
}

export function getZoneRelocations(params: ZoneRelocationListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<ZoneRelocationListResponse>(`/balances/relocations${q ? `?${q}` : ''}`, { signal })
}
