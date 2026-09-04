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
  is_sandbox: boolean
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
  is_sandbox?: boolean
}

export type MpAccountUpdatePayload = {
  name?: string
  status?: MpAccountStatus
  ozon_client_id?: string
  api_key?: string
  is_sandbox?: boolean
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
  supply_id: string | null
  supply_number: string | null
  supply_status: string | null
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
  variant_id: string
  product_sku: string | null
  product_name: string | null
  color_name: string | null
  size_name: string | null
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
  no_supply?: boolean
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
  if (params.no_supply) sp.set('no_supply', 'true')
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

// --- FBS-поставки ---
export type MpSupplyStatus = 'draft' | 'checking' | 'picking' | 'handover' | 'done' | 'cancelled'
export type MpSupplyOrderState = 'selected' | 'unselected' | 'pending'

export type MpSupplyBoardItem = {
  id: string
  doc_number: string
  status: MpSupplyStatus
  account_id: string
  account_name: string
  marketplace: Marketplace
  client_id: string
  client_name: string | null
  cutoff_at: string | null
  intake_closes_at: string | null
  intake_closed_at: string | null
  overdue: boolean
  orders_total: number
  orders_ready: number
  orders_pending: number
  positions: number
  total_qty: number
  cells_count: number
  unlinked_positions: number
  shortage_positions: number
  no_location_positions: number
  picked_qty: number
  remaining_qty: number
  picker_id: string | null
  picker_name: string | null
  claimed_at: string | null
  created_at: string
  updated_at: string
}

export type MpSupplyBoardResponse = {
  items: MpSupplyBoardItem[]
  counters: { supplies: number; orders: number; overdue: number }
}

export type MpSupplyOrderItem = {
  order_id: string
  external_id: string
  order_status: MpOrderStatus
  state: MpSupplyOrderState
  deadline_at: string | null
  created_at_mp: string | null
  lines_total: number
  total_qty: number
  summary: string
  cells: string[]
  blockers: string[]
  ready: boolean
}

export type MpSupplyPickItem = {
  variant_id: string | null
  product_id: string | null
  product_sku: string | null
  product_name: string | null
  color_name: string | null
  size_name: string | null
  offer_id: string | null
  linked: boolean
  need_qty: number
  picked_qty: number
  remaining_qty: number
  available_qty: number
  shortage_qty: number
  orders_count: number
  cells: string[]
}

export type MpSupplyBlocker = {
  kind: 'unlinked' | 'shortage'
  text: string
  orders_count: number
  variant_id: string | null
}

export type MpSupplyDoc = MpSupplyBoardItem & {
  created_by_name: string | null
  external_supply_id: string | null
  checking_at: string | null
  picking_at: string | null
  handover_at: string | null
  done_at: string | null
}

export type MpSupplyDetail = {
  doc: MpSupplyDoc
  orders: MpSupplyOrderItem[]
  pick_list: MpSupplyPickItem[]
  blockers: MpSupplyBlocker[]
}

export type MpSupplyOpItem = {
  id: string
  op_type: string
  comment: string | null
  created_at: string
  created_by_name: string | null
}

export type MpSupplyCandidateItem = {
  order_id: string
  external_id: string
  order_status: MpOrderStatus
  deadline_at: string | null
  created_at_mp: string | null
  total_qty: number
}

export type MpSupplyBoardParams = { client_id?: string; marketplace?: string; account_id?: string }

export function getMpSupplyBoard(params: MpSupplyBoardParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.marketplace) sp.set('marketplace', params.marketplace)
  if (params.account_id) sp.set('account_id', params.account_id)
  const q = sp.toString()
  return request<MpSupplyBoardResponse>(`/marketplaces/supplies/board${q ? `?${q}` : ''}`, { signal })
}

export function getMpSupply(supplyId: string, signal?: AbortSignal) {
  return request<MpSupplyDetail>(`/marketplaces/supplies/${supplyId}`, { signal })
}

export function getMpSupplyCandidates(supplyId: string, signal?: AbortSignal) {
  return request<{ items: MpSupplyCandidateItem[] }>(
    `/marketplaces/supplies/${supplyId}/candidates`, { signal },
  )
}

export function getMpSupplyOps(supplyId: string, signal?: AbortSignal) {
  return request<{ items: MpSupplyOpItem[] }>(`/marketplaces/supplies/${supplyId}/ops`, { signal })
}

export function setMpSupplyOrders(supplyId: string, orderIds: string[]) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/orders`, {
    method: 'PUT',
    body: JSON.stringify({ order_ids: orderIds }),
  })
}

export function dockMpSupplyOrders(supplyId: string, orderIds: string[]) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/dock`, {
    method: 'POST',
    body: JSON.stringify({ order_ids: orderIds }),
  })
}

/** Снять заказ с поставки, уже стоящей на сборке — разбор недостачи.
 *  Сборка не закрывается недособранной, поэтому «товара нет» решается составом. */
export function dropMpSupplyOrder(supplyId: string, orderId: string) {
  return request<{ message: string }>(
    `/marketplaces/supplies/${supplyId}/orders/${orderId}/drop`, { method: 'POST' },
  )
}

export function advanceMpSupply(supplyId: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/advance`, { method: 'POST' })
}

export function cancelMpSupply(supplyId: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/cancel`, { method: 'POST' })
}

export const MP_SUPPLY_STATUS_LABELS: Record<MpSupplyStatus, string> = {
  draft: 'Состав',
  checking: 'Проверка',
  picking: 'Сборка',
  handover: 'Передача',
  done: 'Передана',
  cancelled: 'Аннулирована',
}

/** Подпись главной кнопки фазы — она же индикатор, что сейчас делает менеджер. */
export const MP_SUPPLY_ADVANCE_LABELS: Record<MpSupplyStatus, string> = {
  draft: 'Утвердить состав',
  checking: 'Передать в сборку',
  picking: 'Собрано, к передаче',
  handover: 'Закрыть поставку',
  done: '',
  cancelled: '',
}

export function mpSupplyStatusTone(status: MpSupplyStatus): BadgeTone {
  const map: Record<MpSupplyStatus, BadgeTone> = {
    draft: '',
    checking: 'warning',
    picking: 'info',
    handover: 'accent',
    done: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}
