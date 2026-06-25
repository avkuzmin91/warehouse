import { request } from './http'

// --- Types --- (зеркало backend/modules/locations/schemas.py)
export type LocationMatch = {
  id: string
  code: string
  room: string | null
  rack: string | null
  section: string | null
  floor: string | null
  kind: string
  is_packing_zone: boolean
  is_shipping_zone: boolean
  is_active: boolean
  is_deleted: boolean
  created_at: string
}

export type LocationLookupResponse = { found: boolean; location: LocationMatch | null }

// QR ячейки несёт payload «wms:loc:<id>» — префикс отличает место от ШК товара.
export const LOCATION_QR_PREFIX = 'wms:loc:'

export function isLocationCode(raw: string): boolean {
  return raw.trim().startsWith(LOCATION_QR_PREFIX)
}

// --- API functions ---
export function getLocationByCode(code: string, signal?: AbortSignal): Promise<LocationLookupResponse> {
  return request<LocationLookupResponse>(`/locations/by-code/${encodeURIComponent(code)}`, { signal })
}
