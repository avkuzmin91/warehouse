import { request } from './http'
import type { ClientStoreItem, DictionaryItem, InventoryProductLookup, InventoryProductTypeLookup } from './domainTypes'

export function getInventoryClients(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/clients', { signal })
}

export function getInventoryClientStores(clientId: string | null | undefined, signal?: AbortSignal) {
  const q = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  return request<ClientStoreItem[]>(`/inventory/lookups/client-stores${q}`, { signal })
}

export function getInventoryColors(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/colors', { signal })
}

// Ключ — product_id (а не SKU): товары «ожидают SKU» имеют пустой SKU.
export function getInventoryColorsForProduct(productId: string, signal?: AbortSignal) {
  return request<DictionaryItem[]>(
    `/inventory/lookups/colors-for-sku?product_id=${encodeURIComponent(productId)}`,
    { signal },
  )
}

export function getInventorySizesForProductAndColor(productId: string, colorId: string, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('product_id', productId)
  sp.set('color_id', colorId)
  return request<DictionaryItem[]>(`/inventory/lookups/sizes-for-sku?${sp.toString()}`, { signal })
}

export type ProductVariantPair = {
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
}

/** Полная матрица вариантов товара (цвет × размер) одним запросом — для массового ввода. */
export function getInventoryProductVariants(productId: string, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('product_id', productId)
  return request<ProductVariantPair[]>(`/inventory/lookups/variants?${sp.toString()}`, { signal })
}

export function getInventorySizes(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/sizes', { signal })
}

export function getInventorySuppliers(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/suppliers', { signal })
}

export function getInventoryProductTypes(signal?: AbortSignal) {
  return request<InventoryProductTypeLookup[]>('/inventory/lookups/product-types', { signal })
}

export function getInventoryProducts(clientId?: string | null, signal?: AbortSignal) {
  const q = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  return request<InventoryProductLookup[]>(`/inventory/lookups/products${q}`, { signal })
}

export function getInventoryWarehouses(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/warehouses', { signal })
}

export function getInventoryCarriers(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/carriers', { signal })
}

export function getInventoryUnloadingZones(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/unloading-zones', { signal })
}

export function getInventoryVehicleTypes(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/vehicle-types', { signal })
}

export function getInventoryPositions(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/positions', { signal })
}
