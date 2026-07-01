import { request } from './http'

// --- Types --- (подмножество web frontend/src/api/boxPricingApi.ts)
export type ClientBoxPriceDetail = {
  client_id: string
  client_name: string
  price_kop: number | null
}

export type SetBoxPricePayload = {
  price_kop: number
  effective_from?: string
  note?: string
}

// --- API functions ---
export function getClientBoxPrices(clientId: string, signal?: AbortSignal): Promise<ClientBoxPriceDetail> {
  return request<ClientBoxPriceDetail>(`/box-pricing/clients/${clientId}`, { signal })
}

export function setClientBoxPrice(clientId: string, payload: SetBoxPricePayload): Promise<{ message: string }> {
  return request<{ message: string }>(`/box-pricing/clients/${clientId}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
