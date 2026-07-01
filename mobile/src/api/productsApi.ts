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

// Присвоение/смена базового SKU товара (для строк «ожидает SKU»). Admin/manager-эндпоинт.
export function assignProductSku(productId: string, skuBase: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify({ sku_base: skuBase }),
  })
}

// Кратность упаковки товара (штук в коробе / коробов на палете) — пишется в карточку
// и переиспользуется на всех будущих отгрузках. Admin/manager-эндпоинт.
export function updateProductMultiplicity(
  productId: string,
  patch: { items_per_box?: number | null; boxes_per_pallet?: number | null },
): Promise<{ message: string }> {
  return request<{ message: string }>(`/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// --- Helpers ---
export function barcodeVariantLabel(m: BarcodeMatch): string {
  return [m.color_name, m.size_name].filter(Boolean).join(' · ')
}
