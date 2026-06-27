import { request } from './http'

// --- Types ---
export type RentRateHistoryEntry = {
  id: string
  rent_monthly_kopecks: number
  effective_from: string
  note: string | null
  created_at: string
  created_by: string | null
}

export type WarehouseRentDetail = {
  warehouse_id: string
  warehouse_name: string
  rent_monthly_kopecks: number | null
  history: RentRateHistoryEntry[]
}

export type SetRentRatePayload = {
  rent_monthly_kopecks: number
  effective_from?: string
  note?: string
}

// --- API functions ---
export function getWarehouseRent(warehouseId: string, signal?: AbortSignal) {
  return request<WarehouseRentDetail>(`/own-warehouses/${warehouseId}/rent-rates`, { signal })
}

export function setWarehouseRent(warehouseId: string, payload: SetRentRatePayload) {
  return request<{ message: string }>(`/own-warehouses/${warehouseId}/rent-rates`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteWarehouseRentRate(warehouseId: string, rateId: string) {
  return request<{ message: string }>(`/own-warehouses/${warehouseId}/rent-rates/${rateId}`, {
    method: 'DELETE',
  })
}
