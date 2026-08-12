import { request } from './http'

// --- Types --- (зеркало backend/modules/scan/schemas.py)
export type ScanContextDoc = {
  doc_type: 'receipt' | 'shipment' | 'dispatch'
  doc_id: string
  doc_number: string
  status: string
  cargo_type: string | null
  priority_rank: number | null
  planned_qty: number | null
  done_qty: number | null
}

export type ScanContextResponse = { documents: ScanContextDoc[] }

// --- API functions ---
// Живые документы по отсканированному объекту (ровно один из параметров). Role-фильтр
// не применяется — это контекст объекта, не личная очередь (её отдаёт /tasks).
export function getScanContext(
  params: { productId?: string; locationId?: string },
  signal?: AbortSignal,
): Promise<ScanContextResponse> {
  const sp = new URLSearchParams()
  if (params.productId) sp.set('product_id', params.productId)
  if (params.locationId) sp.set('location_id', params.locationId)
  return request<ScanContextResponse>(`/scan/context?${sp.toString()}`, { signal })
}
