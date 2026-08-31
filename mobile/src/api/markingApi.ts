import { request } from './http'

// --- Types --- (зеркало backend/modules/marking/schemas.py)
export type MarkingCode = {
  id: string
  gtin: string
  serial: string
  raw: string
  variant_id: string | null
  product_id: string | null
  product_name: string | null
  sku: string | null
  client_id: string | null
  client_name: string | null
  is_exact: boolean
  created_at: string | null
  created_by_email: string | null
}

// duplicate — код уже в реестре, в code лежит ранее сохранённая запись.
export type MarkingScanStatus = 'saved' | 'duplicate'

export type MarkingScanResponse = { status: MarkingScanStatus; code: MarkingCode }

export type MarkingCodeListResponse = {
  items: MarkingCode[]
  total: number
  page: number
  limit: number
}

export type MarkingCodeListParams = {
  page?: number
  limit?: number
  client_id?: string
  search?: string
}

// --- API functions ---
export function scanMarkingCode(raw: string): Promise<MarkingScanResponse> {
  return request<MarkingScanResponse>('/marking/codes', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  })
}

export function getMarkingCodes(
  params: MarkingCodeListParams = {},
  signal?: AbortSignal,
): Promise<MarkingCodeListResponse> {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<MarkingCodeListResponse>(`/marking/codes${q ? `?${q}` : ''}`, { signal })
}
