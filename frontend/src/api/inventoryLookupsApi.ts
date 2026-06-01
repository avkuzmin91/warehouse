import { request } from './http'
import type { DictionaryItem, InventoryProductLookup, InventoryProductTypeLookup } from './domainTypes'

export function getInventoryClients(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/clients', { signal })
}

export function getInventoryColors(signal?: AbortSignal) {
  return request<DictionaryItem[]>('/inventory/lookups/colors', { signal })
}

export function getInventoryColorsForProductSku(sku: string, signal?: AbortSignal) {
  const s = sku.trim()
  return request<DictionaryItem[]>(
    `/inventory/lookups/colors-for-sku?sku=${encodeURIComponent(s)}`,
    { signal },
  )
}

export function getInventorySizesForProductSkuAndColor(sku: string, colorId: string, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('sku', sku.trim())
  sp.set('color_id', colorId)
  return request<DictionaryItem[]>(`/inventory/lookups/sizes-for-sku?${sp.toString()}`, { signal })
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
