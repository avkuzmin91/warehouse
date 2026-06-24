import { request } from './http'

// Минимальная форма справочного элемента — нам нужны только id/name (+ активность).
export type Zone = { id: string; name: string; is_active?: boolean; is_deleted?: boolean }

// Доступно складскому составу (shipment_viewer). Возвращает уже активные строки.
export function getUnloadingZones(signal?: AbortSignal): Promise<Zone[]> {
  return request<Zone[]>('/inventory/lookups/unloading-zones', { signal })
}

// --- Справочники для менеджерских форм создания ---
export type DictionaryItem = { id: string; name: string; is_active?: boolean; is_deleted?: boolean }

export type ProductLookup = {
  id: string
  name: string
  sku: string
  sku_pending?: boolean
  requires_color: boolean
  requires_size: boolean
}

// Реально существующие варианты товара (product_variants) — сетка цвет × размер.
export type ProductVariantPair = {
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
}

export type ClientStoreItem = { id: string; client_id: string; name: string; is_active: boolean; is_deleted?: boolean }

export function getClients(signal?: AbortSignal): Promise<DictionaryItem[]> {
  return request<DictionaryItem[]>('/inventory/lookups/clients', { signal })
}

// --- Справочники для рейсов (планирование менеджером) ---
// origin рейса — точка логистики (warehouses), не «Наши склады».
export function getWarehouses(signal?: AbortSignal): Promise<DictionaryItem[]> {
  return request<DictionaryItem[]>('/inventory/lookups/warehouses', { signal })
}

export function getCarriers(signal?: AbortSignal): Promise<DictionaryItem[]> {
  return request<DictionaryItem[]>('/inventory/lookups/carriers', { signal })
}

export function getVehicleTypes(signal?: AbortSignal): Promise<DictionaryItem[]> {
  return request<DictionaryItem[]>('/inventory/lookups/vehicle-types', { signal })
}

export function getClientStores(clientId: string | null | undefined, signal?: AbortSignal): Promise<ClientStoreItem[]> {
  const q = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  return request<ClientStoreItem[]>(`/inventory/lookups/client-stores${q}`, { signal })
}

export function getProducts(clientId?: string | null, signal?: AbortSignal): Promise<ProductLookup[]> {
  const q = clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''
  return request<ProductLookup[]>(`/inventory/lookups/products${q}`, { signal })
}

export function getProductVariants(productId: string, signal?: AbortSignal): Promise<ProductVariantPair[]> {
  const sp = new URLSearchParams()
  sp.set('product_id', productId)
  return request<ProductVariantPair[]>(`/inventory/lookups/variants?${sp.toString()}`, { signal })
}
