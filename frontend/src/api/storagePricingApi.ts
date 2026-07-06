import { request } from './http'

// --- Types ---
export type StorageUnit = 'piece' | 'box' | 'pallet'

export type ClientStoragePriceItem = {
  client_id: string
  client_name: string
  unit: StorageUnit | null
  unit_label: string | null
  price_kop: number | null
  free_days: number | null
  has_price: boolean
}

export type ClientStoragePricesResponse = {
  items: ClientStoragePriceItem[]
  total: number
  page: number
  limit: number
}

export type StoragePriceHistoryEntry = {
  id: string
  unit: StorageUnit
  price_kop: number
  free_days: number
  effective_from: string
  note: string | null
  created_at: string
  created_by: string | null
}

export type ClientStoragePriceDetail = {
  client_id: string
  client_name: string
  unit: StorageUnit | null
  price_kop: number | null
  free_days: number | null
  billing_start: string | null
  history: StoragePriceHistoryEntry[]
}

export type ClientStoragePricesParams = {
  page?: number
  limit?: number
  search?: string
  missing_only?: boolean
}

export type SetStoragePricePayload = {
  unit: StorageUnit
  price_kop: number
  free_days: number
  effective_from?: string
  note?: string
}

export type StorageReportItem = {
  client_id: string
  client_name: string | null
  billable_days: number
  amount_kop: number
  uninvoiced_kop: number
  missing_capacity_qty: number
  last_charge_date: string | null
  unit: StorageUnit | null
  rate_kop: number | null
  free_days: number | null
}

export type StorageReportResponse = {
  items: StorageReportItem[]
  total_amount_kop: number
  total_uninvoiced_kop: number
}

export type StorageDayItem = {
  id: string
  charge_date: string
  unit: StorageUnit
  unit_label: string
  rate_kop: number
  free_days: number
  qty_pieces: number
  units_qty: number
  amount_kop: number
  missing_capacity_qty: number
  invoice_id: string | null
  invoice_number: string | null
}

export type StorageChargeLine = {
  id: string
  receipt_line_id: string | null
  receipt_doc_id: string | null
  receipt_doc_number: string | null
  product_id: string | null
  product_sku: string | null
  product_name: string | null
  color_name: string | null
  size_name: string | null
  accepted_on: string | null
  age_days: number
  qty_pieces: number
  billable_qty: number
}

export type UninvoicedStorageMonth = {
  month: string
  month_label: string
  days: number
  date_from: string
  date_to: string
  amount_kop: number
}

export type UninvoicedStorageResponse = {
  items: UninvoicedStorageMonth[]
  total_amount_kop: number
}

export type StorageChargeDetail = {
  id: string
  client_id: string
  client_name: string | null
  charge_date: string
  unit: StorageUnit
  unit_label: string
  rate_kop: number
  free_days: number
  qty_pieces: number
  units_qty: number
  amount_kop: number
  missing_capacity_qty: number
  lines: StorageChargeLine[]
}

// --- API functions ---
export function getStoragePricedClients(params: ClientStoragePricesParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.missing_only) sp.set('missing_only', 'true')
  const q = sp.toString()
  return request<ClientStoragePricesResponse>(`/storage-pricing/clients${q ? `?${q}` : ''}`, { signal })
}

export function getClientStoragePrices(clientId: string, signal?: AbortSignal) {
  return request<ClientStoragePriceDetail>(`/storage-pricing/clients/${clientId}`, { signal })
}

export function setClientStoragePrice(clientId: string, payload: SetStoragePricePayload) {
  return request<{ message: string }>(`/storage-pricing/clients/${clientId}/prices`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteClientStoragePrice(clientId: string, priceId: string) {
  return request<{ message: string }>(`/storage-pricing/clients/${clientId}/prices/${priceId}`, {
    method: 'DELETE',
  })
}

export function getStorageReport(params: { date_from: string; date_to: string; client_id?: string }, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<StorageReportResponse>(`/storage-pricing/report?${sp.toString()}`, { signal })
}

export function getStorageClientDays(clientId: string, params: { date_from: string; date_to: string }, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('date_from', params.date_from)
  sp.set('date_to', params.date_to)
  return request<{ items: StorageDayItem[] }>(`/storage-pricing/report/${clientId}/days?${sp.toString()}`, { signal })
}

export function getUninvoicedStorage(clientId: string, signal?: AbortSignal) {
  return request<UninvoicedStorageResponse>(`/storage-pricing/clients/${clientId}/uninvoiced`, { signal })
}

export function getStorageChargeDetail(chargeId: string, signal?: AbortSignal) {
  return request<StorageChargeDetail>(`/storage-pricing/charges/${chargeId}`, { signal })
}

// --- Labels & helpers ---
export const STORAGE_UNIT_LABELS: Record<StorageUnit, string> = {
  piece: 'Штука',
  box: 'Короб',
  pallet: 'Палета',
}

export function storageRateLabel(item: { unit: StorageUnit | null; rate_kop?: number | null; price_kop?: number | null }): string {
  const kop = item.rate_kop ?? item.price_kop
  if (kop == null || !item.unit) return '—'
  const unit = STORAGE_UNIT_LABELS[item.unit].toLowerCase()
  return `${(kop / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽ / ${unit} · день`
}
