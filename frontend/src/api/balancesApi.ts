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
