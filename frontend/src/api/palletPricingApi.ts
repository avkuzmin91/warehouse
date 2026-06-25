import { request } from './http'

// --- Types ---
export type ClientPalletPriceItem = {
  client_id: string
  client_name: string
  price_kop: number | null
  has_price: boolean
}

export type ClientPalletPricesResponse = {
  items: ClientPalletPriceItem[]
  total: number
  page: number
  limit: number
}

export type PalletPriceHistoryEntry = {
  id: string
  price_kop: number
  effective_from: string
  note: string | null
  created_at: string
  created_by: string | null
}

export type ClientPalletPriceDetail = {
  client_id: string
  client_name: string
  price_kop: number | null
  history: PalletPriceHistoryEntry[]
}

export type ClientPalletPricesParams = {
  page?: number
  limit?: number
  search?: string
  missing_only?: boolean
}

export type SetPalletPricePayload = {
  price_kop: number
  effective_from?: string
  note?: string
}

// --- API functions ---
export function getPalletPricedClients(params: ClientPalletPricesParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.missing_only) sp.set('missing_only', 'true')
  const q = sp.toString()
  return request<ClientPalletPricesResponse>(`/pallet-pricing/clients${q ? `?${q}` : ''}`, { signal })
}

export function getClientPalletPrices(clientId: string, signal?: AbortSignal) {
  return request<ClientPalletPriceDetail>(`/pallet-pricing/clients/${clientId}`, { signal })
}

export function setClientPalletPrice(clientId: string, payload: SetPalletPricePayload) {
  return request<{ message: string }>(`/pallet-pricing/clients/${clientId}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteClientPalletPrice(clientId: string, priceId: string) {
  return request<{ message: string }>(`/pallet-pricing/clients/${clientId}/prices/${priceId}`, {
    method: 'DELETE',
  })
}
