import { request } from './http'

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
  good: number
  defect: number
  on_review: number
  on_packing: number
  total: number
  docs_count: number
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

export type BalanceZoneStatus = 'good' | 'defect' | 'on_review' | 'on_packing'

export type BalanceZoneItem = {
  location_id:   string | null
  location_name: string | null
  status:        BalanceZoneStatus
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
}

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
  status:        'good' | 'defect' | 'on_review'
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

export type ZoneRelocationItem = {
  id:               string
  created_at:       string
  created_by_email: string | null
  status:           BalanceZoneStatus
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
