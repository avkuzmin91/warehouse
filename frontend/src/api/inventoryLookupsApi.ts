import { request } from './http'
import type { DictionaryItem, InventoryProductLookup, InventoryProductTypeLookup } from './domainTypes'

export function getInventoryClients() {
  return request<DictionaryItem[]>('/inventory/lookups/clients')
}

export function getInventoryColors() {
  return request<DictionaryItem[]>('/inventory/lookups/colors')
}

export function getInventoryColorsForProductSku(sku: string) {
  const s = sku.trim()
  return request<DictionaryItem[]>(
    `/inventory/lookups/colors-for-sku?sku=${encodeURIComponent(s)}`,
  )
}

export function getInventorySizesForProductSkuAndColor(sku: string, colorId: string) {
  const sp = new URLSearchParams()
  sp.set('sku', sku.trim())
  sp.set('color_id', colorId)
  return request<DictionaryItem[]>(`/inventory/lookups/sizes-for-sku?${sp.toString()}`)
}

export function getInventorySizes() {
  return request<DictionaryItem[]>('/inventory/lookups/sizes')
}

export function getInventorySuppliers() {
  return request<DictionaryItem[]>('/inventory/lookups/suppliers')
}

export function getInventoryProductTypes() {
  return request<InventoryProductTypeLookup[]>('/inventory/lookups/product-types')
}

export function getInventoryProducts(clientId?: string | null) {
  const q = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  return request<InventoryProductLookup[]>(`/inventory/lookups/products${q}`)
}

export function getInventoryProductSkus() {
  return request<string[]>('/inventory/lookups/skus')
}

export function getInventoryShipmentDestinations() {
  return request<DictionaryItem[]>('/inventory/lookups/shipment-destinations')
}
