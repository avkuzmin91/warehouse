import { request } from './http'

// --- Types ---
export type PricedProductItem = {
  id: string
  name: string
  sku: string | null
  sku_pending: boolean
  client_id: string | null
  client_name: string | null
  good_price_kop: number | null
  defect_price_kop: number | null
  has_price: boolean
}

export type PricedProductsResponse = {
  items: PricedProductItem[]
  total: number
  page: number
  limit: number
}

export type PriceHistoryEntry = {
  id: string
  price_kop: number
  effective_from: string
  note: string | null
  created_at: string
  created_by: string | null
}

export type ProductPriceDetail = {
  product_id: string
  product_name: string
  sku: string | null
  client_id: string | null
  client_name: string | null
  good_price_kop: number | null
  defect_price_kop: number | null
  good_history: PriceHistoryEntry[]
  defect_history: PriceHistoryEntry[]
}

export type PricedProductsParams = {
  page?: number
  limit?: number
  search?: string
  client_id?: string
  missing_only?: boolean
}

export type SetPricePayload = {
  client_id?: string
  good_price_kop?: number | null
  defect_price_kop?: number | null
  effective_from?: string
  note?: string
}

// --- API functions ---
export function getPricedProducts(params: PricedProductsParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.missing_only) sp.set('missing_only', 'true')
  const q = sp.toString()
  return request<PricedProductsResponse>(`/pricing/products${q ? `?${q}` : ''}`, { signal })
}

export function getProductPrices(productId: string, clientId?: string, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (clientId) sp.set('client_id', clientId)
  const q = sp.toString()
  return request<ProductPriceDetail>(`/pricing/products/${productId}${q ? `?${q}` : ''}`, { signal })
}

export function setProductPrice(productId: string, payload: SetPricePayload) {
  return request<{ message: string }>(`/pricing/products/${productId}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
