import { request } from './http'

// --- Types ---
export type ClientBoxPriceItem = {
  client_id: string
  client_name: string
  price_kop: number | null
  has_price: boolean
}

export type ClientBoxPricesResponse = {
  items: ClientBoxPriceItem[]
  total: number
  page: number
  limit: number
}

export type BoxPriceHistoryEntry = {
  id: string
  price_kop: number
  effective_from: string
  note: string | null
  created_at: string
  created_by: string | null
}

export type ClientBoxPriceDetail = {
  client_id: string
  client_name: string
  price_kop: number | null
  history: BoxPriceHistoryEntry[]
}

export type ClientBoxPricesParams = {
  page?: number
  limit?: number
  search?: string
  missing_only?: boolean
}

export type SetBoxPricePayload = {
  price_kop: number
  effective_from?: string
  note?: string
}

// --- API functions ---
export function getBoxPricedClients(params: ClientBoxPricesParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.missing_only) sp.set('missing_only', 'true')
  const q = sp.toString()
  return request<ClientBoxPricesResponse>(`/box-pricing/clients${q ? `?${q}` : ''}`, { signal })
}

export function getClientBoxPrices(clientId: string, signal?: AbortSignal) {
  return request<ClientBoxPriceDetail>(`/box-pricing/clients/${clientId}`, { signal })
}

export function setClientBoxPrice(clientId: string, payload: SetBoxPricePayload) {
  return request<{ message: string }>(`/box-pricing/clients/${clientId}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteClientBoxPrice(clientId: string, priceId: string) {
  return request<{ message: string }>(`/box-pricing/clients/${clientId}/prices/${priceId}`, {
    method: 'DELETE',
  })
}
