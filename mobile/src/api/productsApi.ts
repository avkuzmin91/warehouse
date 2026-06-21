import { request } from './http'

// --- Types --- (зеркало backend/modules/products/schemas.py)
export type BarcodeMatch = {
  variant_id: string
  product_id: string
  product_name: string
  sku: string
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  client_id: string | null
  client_name: string | null
}

export type BarcodeLookupResponse = { found: boolean; match: BarcodeMatch | null }

// --- API functions ---
export function getProductByBarcode(code: string, signal?: AbortSignal): Promise<BarcodeLookupResponse> {
  return request<BarcodeLookupResponse>(`/products/by-barcode/${encodeURIComponent(code)}`, { signal })
}

// --- Helpers ---
export function barcodeVariantLabel(m: BarcodeMatch): string {
  return [m.color_name, m.size_name].filter(Boolean).join(' · ')
}
