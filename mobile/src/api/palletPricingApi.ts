import { request } from './http'

// --- Types --- (подмножество web frontend/src/api/palletPricingApi.ts)
export type ClientPalletPriceDetail = {
  client_id: string
  client_name: string
  price_kop: number | null
}

export type SetPalletPricePayload = {
  price_kop: number
  effective_from?: string
  note?: string
}

// --- API functions ---
export function getClientPalletPrices(clientId: string, signal?: AbortSignal): Promise<ClientPalletPriceDetail> {
  return request<ClientPalletPriceDetail>(`/pallet-pricing/clients/${clientId}`, { signal })
}

export function setClientPalletPrice(clientId: string, payload: SetPalletPricePayload): Promise<{ message: string }> {
  return request<{ message: string }>(`/pallet-pricing/clients/${clientId}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
