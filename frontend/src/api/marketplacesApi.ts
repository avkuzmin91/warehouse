import { request } from './http'
import type { BadgeTone } from '../ui/primitives/Badge'

// --- Types ---
export type Marketplace = 'ozon' | 'wb'
export type MpAccountStatus = 'active' | 'paused'
export type MpOrderStatus = 'new' | 'in_progress' | 'shipped' | 'done' | 'cancelled'

export type MpAccountItem = {
  id: string
  client_id: string
  client_name: string | null
  marketplace: Marketplace
  name: string
  ozon_client_id_masked: string | null
  api_key_masked: string
  status: MpAccountStatus
  last_sync_at: string | null
  last_sync_error: string | null
  created_at: string
}

export type MpAccountsResponse = { items: MpAccountItem[] }

export type MpAccountCreatePayload = {
  client_id: string
  marketplace: Marketplace
  name: string
  ozon_client_id?: string
  api_key: string
}

export type MpAccountUpdatePayload = {
  name?: string
  status?: MpAccountStatus
  ozon_client_id?: string
  api_key?: string
}

export type SyncStatsResponse = { message: string; stats: Record<string, number> }

export type MpOrderListItem = {
  id: string
  account_id: string
  account_name: string
  marketplace: Marketplace
  client_id: string
  client_name: string | null
  external_id: string
  status: MpOrderStatus
  external_status: string
  created_at_mp: string | null
  deadline_at: string | null
  deadline_source: 'api' | 'estimated' | null
  total_qty: number
  lines_total: number
  lines_linked: number
  first_seen_at: string
  updated_at: string
}

export type MpOrdersResponse = { items: MpOrderListItem[]; total: number; page: number; limit: number }

export type MpOrdersSummary = { by_status: Record<string, number>; overdue_count: number }

export type MpOrderLine = {
  id: string
  offer_id: string | null
  title: string | null
  qty: number
  price_kopecks: number | null
  mp_product_id: string | null
  mp_external_id: string | null
  external_size: string | null
  linked: boolean
  product_id: string | null
  variant_id: string | null
  product_sku: string | null
  product_name: string | null
  color_name: string | null
  size_name: string | null
}

export type MpOrderDetail = { doc: MpOrderListItem; lines: MpOrderLine[] }

export type MpProductSuggestion = {
  product_id: string
  product_sku: string | null
  product_name: string | null
}

export type MpProductItem = {
  id: string
  external_id: string
  external_size: string | null
  offer_id: string | null
  title: string | null
  barcodes: string[]
  linked: boolean
  link_source: 'barcode_auto' | 'manual' | null
  product_id: string | null
  variant_id: string | null
  product_sku: string | null
  product_name: string | null
  color_name: string | null
  size_name: string | null
  barcode_conflict: boolean
  suggestion: MpProductSuggestion | null
}

export type MpProductsResponse = { items: MpProductItem[]; total: number; page: number; limit: number }

export type MpOrderListParams = {
  page?: number
  limit?: number
  account_id?: string
  client_id?: string
  marketplace?: string
  status?: string
  overdue?: boolean
  search?: string
}

export type MpProductListParams = {
  account_id: string
  page?: number
  limit?: number
  linked?: 'all' | 'linked' | 'unlinked'
  search?: string
}

// --- API functions ---
export function getMpAccounts(signal?: AbortSignal) {
  return request<MpAccountsResponse>('/marketplaces/accounts', { signal })
}

export function createMpAccount(payload: MpAccountCreatePayload) {
  return request<{ message: string }>('/marketplaces/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateMpAccount(accountId: string, payload: MpAccountUpdatePayload) {
  return request<{ message: string }>(`/marketplaces/accounts/${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteMpAccount(accountId: string) {
  return request<{ message: string }>(`/marketplaces/accounts/${accountId}`, { method: 'DELETE' })
}

export function checkMpAccount(accountId: string) {
  return request<{ message: string }>(`/marketplaces/accounts/${accountId}/check`, { method: 'POST' })
}

export function syncMpAccountCatalog(accountId: string) {
  return request<SyncStatsResponse>(`/marketplaces/accounts/${accountId}/sync-catalog`, { method: 'POST' })
}

export function syncMpAccountOrders(accountId: string) {
  return request<SyncStatsResponse>(`/marketplaces/accounts/${accountId}/sync-orders`, { method: 'POST' })
}

export function autoLinkMpAccount(accountId: string) {
  return request<SyncStatsResponse>(`/marketplaces/accounts/${accountId}/auto-link`, { method: 'POST' })
}

export function getMpOrders(params: MpOrderListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.account_id) sp.set('account_id', params.account_id)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.marketplace) sp.set('marketplace', params.marketplace)
  if (params.status) sp.set('status', params.status)
  if (params.overdue) sp.set('overdue', 'true')
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<MpOrdersResponse>(`/marketplaces/orders${q ? `?${q}` : ''}`, { signal })
}

export function getMpOrdersSummary(params: Omit<MpOrderListParams, 'page' | 'limit' | 'status' | 'overdue'> = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.account_id) sp.set('account_id', params.account_id)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.marketplace) sp.set('marketplace', params.marketplace)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<MpOrdersSummary>(`/marketplaces/orders/summary${q ? `?${q}` : ''}`, { signal })
}

export function getMpOrder(orderId: string, signal?: AbortSignal) {
  return request<MpOrderDetail>(`/marketplaces/orders/${orderId}`, { signal })
}

export function getMpProducts(params: MpProductListParams, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('account_id', params.account_id)
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.linked && params.linked !== 'all') sp.set('linked', params.linked)
  if (params.search) sp.set('search', params.search)
  return request<MpProductsResponse>(`/marketplaces/products?${sp.toString()}`, { signal })
}

export function linkMpProduct(mpProductId: string, payload: { product_id: string; variant_id?: string | null }) {
  return request<{ message: string }>(`/marketplaces/products/${mpProductId}/link`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function unlinkMpProduct(mpProductId: string) {
  return request<{ message: string }>(`/marketplaces/products/${mpProductId}/link`, { method: 'DELETE' })
}

// --- Labels & helpers ---
export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  ozon: 'Ozon',
  wb: 'Wildberries',
}

export const MP_ORDER_STATUS_LABELS: Record<MpOrderStatus, string> = {
  new: 'Ждёт сборки',
  in_progress: 'В работе',
  shipped: 'Передан в доставку',
  done: 'Доставлен',
  cancelled: 'Отменён',
}

export const MP_ACCOUNT_STATUS_LABELS: Record<MpAccountStatus, string> = {
  active: 'Активно',
  paused: 'Пауза',
}

export function mpOrderStatusTone(status: MpOrderStatus): BadgeTone {
  const map: Record<MpOrderStatus, BadgeTone> = {
    new: 'warning',
    in_progress: 'info',
    shipped: 'accent',
    done: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}

export function marketplaceTone(marketplace: Marketplace): BadgeTone {
  return marketplace === 'ozon' ? 'info' : 'accent'
}

export function isMpOrderOverdue(item: Pick<MpOrderListItem, 'status' | 'deadline_at'>): boolean {
  if (!item.deadline_at) return false
  if (item.status !== 'new' && item.status !== 'in_progress') return false
  return new Date(item.deadline_at).getTime() < Date.now()
}
