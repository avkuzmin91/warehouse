import { request, requestForm } from './http'

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

// Создание товара менеджером (зеркало web adminApi.createProduct). meta — JSON,
// images — необязательные файлы (первый становится главным). Возвращает id товара в message.
export type ProductCreateMeta = {
  product: {
    name: string
    type_id: string
    sku_base?: string | null
    sku_pending?: boolean
    weight_grams?: number | null
    items_per_box?: number | null
    boxes_per_pallet?: number | null
    client_id: string
    is_active: boolean
    packing_price_good_kop?: number | null
    packing_price_defect_kop?: number | null
  }
  colors: string[]
  dimensions: { length: number; width: number; height: number; sizes: string[] }[]
}

export function createProduct(meta: ProductCreateMeta, images: File[] = []): Promise<{ message: string }> {
  const form = new FormData()
  form.append('meta', JSON.stringify(meta))
  for (const file of images) form.append('images', file)
  return requestForm<{ message: string }>('/products', { method: 'POST', body: form })
}

// Карточка товара (подмножество web ProductItem) — для мобильной правки простых полей.
export type ProductItem = {
  id: string
  name: string
  type_id: string
  type_name: string | null
  sku_base: string | null
  sku_pending: boolean
  weight_grams: number | null
  items_per_box: number | null
  boxes_per_pallet: number | null
  client_id: string | null
  client_name: string | null
  variant_count: number
  is_active: boolean
}

export function getProduct(productId: string, signal?: AbortSignal): Promise<ProductItem> {
  return request<ProductItem>(`/products/${productId}`, { signal })
}

// Правка простых полей карточки (name/client/sku/вес/кратность/активность). Варианты,
// габариты и фото правятся в вебе. Бэк не даёт менять type_id после создания.
export type ProductUpdatePatch = {
  name?: string
  client_id?: string | null
  is_active?: boolean
  sku_base?: string
  sku_pending?: boolean
  weight_grams?: number | null
  items_per_box?: number | null
  boxes_per_pallet?: number | null
}

export function updateProduct(productId: string, patch: ProductUpdatePatch): Promise<{ message: string }> {
  return request<{ message: string }>(`/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// Привязка нового ШК к варианту товара (admin/manager). source — откуда код
// («Упаковка SHP-…»); message = id созданного кода. variant_id можно опустить
// только у товара с единственным вариантом.
export function addProductBarcode(
  productId: string,
  payload: { barcode: string; source?: string | null; variant_id?: string | null },
): Promise<{ message: string }> {
  return request<{ message: string }>(`/products/${productId}/barcodes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// Этикетка кода в карточке товара (плоский список — для выбора в документах).
// Код принадлежит варианту — цвет/размер нужны для фильтра по строке документа.
export type ProductFileItem = {
  id: string
  barcode: string
  variant_id: string | null
  color_id: string | null
  size_id: string | null
  color_name: string | null
  size_name: string | null
  filename: string
  url: string
  mime_type: string | null
}

export function getProductFiles(productId: string, signal?: AbortSignal): Promise<ProductFileItem[]> {
  return request<ProductFileItem[]>(`/products/${productId}/files`, { signal })
}

// Сохранение этикетки к коду (admin/manager). addProductBarcode возвращает id кода в message.
export function addProductBarcodeFile(productId: string, barcodeId: string, file: File): Promise<{ message: string }> {
  const form = new FormData()
  form.append('file', file)
  return requestForm<{ message: string }>(`/products/${productId}/barcodes/${barcodeId}/files`, {
    method: 'POST',
    body: form,
  })
}

// --- Helpers ---
export function barcodeVariantLabel(m: BarcodeMatch): string {
  return [m.color_name, m.size_name].filter(Boolean).join(' · ')
}
