import { request } from './http'

// --- Types --- (подмножество backend/modules/receipts/schemas.py: только состав)
export type ReceiptLine = {
  id: string
  product_name: string | null
  product_sku: string | null
  color_name: string | null
  size_name: string | null
  planned_qty: number
  accepted_qty: number | null
}

type ReceiptDetailResponse = { lines: ReceiptLine[] }

// --- API functions ---
/** Состав поступления — для рейсов без построчной аллокации (legacy-привязка целиком). */
export function getReceiptLines(docId: string, signal?: AbortSignal): Promise<ReceiptLine[]> {
  return request<ReceiptDetailResponse>(`/receipts/${docId}`, { signal }).then((d) => d.lines)
}
