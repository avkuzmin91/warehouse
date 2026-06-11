import { request } from './http'

// --- Types ---

/** Операционный статус запаса: что товар делает.
 *  intake — виртуальный статус отображения: принято по незавершённым поступлениям. */
export type InvOpStatus = 'intake' | 'storage' | 'packing' | 'ready'
/** Качество запаса. «Не проверен» существует только внутри приёмки. */
export type InvQuality = 'good' | 'defect'

export const INV_OP_LABELS: Record<InvOpStatus, string> = {
  intake:  'На приёмке',
  storage: 'На хранении',
  packing: 'На упаковке',
  ready:   'Готов к отгрузке',
}

export const INV_QUALITY_LABELS: Record<InvQuality, string> = {
  good:   'Годный',
  defect: 'Брак',
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
  intake: number
  storage_good: number
  storage_defect: number
  packing_good: number
  packing_defect: number
  ready_good: number
  ready_defect: number
  total: number
  docs_count: number
}

export type BalanceSummary = {
  intake: number
  storage_good: number
  storage_defect: number
  packing_good: number
  packing_defect: number
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
  only_positive?: boolean
}

export type BalanceZonesResponse = {
  items: BalanceZoneItem[]
  /** Выборка обрезана серверным лимитом — список неполный. */
  truncated: boolean
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

export type ZoneRelocationItem = {
  id:               string
  created_at:       string
  created_by_email: string | null
  from_op:          InvOpStatus | 'shipped'
  to_op:            InvOpStatus | 'shipped'
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
