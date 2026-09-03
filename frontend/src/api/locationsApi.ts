import { request } from './http'

// --- Types ---
export type LocationKind = 'cell' | 'special'

export type LocationItem = {
  id: string
  code: string // адрес «1-А-10-1» у ячейки либо имя служебной зоны
  room: string | null
  rack: string | null
  section: string | null
  floor: string | null
  kind: LocationKind
  is_packing_zone: boolean
  is_shipping_zone: boolean
  is_active: boolean
  is_deleted: boolean
  created_at: string
}

export type LocationListResponse = {
  items: LocationItem[]
  total: number
  page: number
  limit: number
}

export type LocationListParams = {
  page?: number
  limit?: number
  room?: string
  rack?: string
  search?: string
}

export type LocationCreatePayload = {
  room: string
  rack: string
  section: number
  floor: number
  is_active?: boolean
}

export type LocationBulkPayload = {
  room: string
  racks: string[]
  sections: number
  floors: number
  is_active?: boolean
}

export type LocationBulkResult = { created: number; skipped: number }

export type LocationBulkDeleteResult = { deleted: number; skipped: number }

export type LocationLookupResponse = { found: boolean; location: LocationItem | null }

export type LocationLabel = {
  id: string
  code: string
  payload: string
  qr_svg: string
  kind: LocationKind
  room: string | null
  rack: string | null
  section: string | null
  floor: string | null
}
export type LocationLabelsResponse = { items: LocationLabel[] }

// --- API functions ---
export function getLocations(params: LocationListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.room) sp.set('room', params.room)
  if (params.rack) sp.set('rack', params.rack)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<LocationListResponse>(`/locations${q ? `?${q}` : ''}`, { signal })
}

export function createLocation(payload: LocationCreatePayload) {
  return request<LocationItem>('/locations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function bulkCreateLocations(payload: LocationBulkPayload) {
  return request<LocationBulkResult>('/locations/bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getLocationLabels(
  params: { room?: string; rack?: string; ids?: string[] } = {},
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  if (params.ids && params.ids.length) sp.set('ids', params.ids.join(','))
  if (params.room) sp.set('room', params.room)
  if (params.rack) sp.set('rack', params.rack)
  const q = sp.toString()
  return request<LocationLabelsResponse>(`/locations/labels${q ? `?${q}` : ''}`, { signal })
}

export function bulkDeleteLocations(ids: string[]) {
  return request<LocationBulkDeleteResult>('/locations/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

export function deleteLocation(id: string) {
  return request<{ message: string }>(`/locations/${id}`, { method: 'DELETE' })
}

export function lookupLocation(code: string, signal?: AbortSignal) {
  return request<LocationLookupResponse>(`/locations/by-code/${encodeURIComponent(code)}`, { signal })
}
