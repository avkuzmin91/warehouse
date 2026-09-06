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

/** Где заказ в НАШЕМ процессе — вторая ось к статусу площадки (`MpOrderStatus`). */
export type MpOrderStage = 'pool' | 'in_supply' | 'packed' | 'handed' | 'done' | 'cancelled'
/** Что мешает собрать заказ. Тот же словарь, что у состава поставки. */
export type MpOrderBlocker = 'unlinked' | 'shortage' | 'no_location'

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
  supply_status: MpSupplyStatus | null
  supply_state: string | null
  first_seen_at: string
  updated_at: string
  packed_at: string | null
  mp_shipped_at: string | null
  mp_error: string | null
  label_url: string | null
  label_barcode: string | null
  stage: MpOrderStage
  /** Состав словами: «Товар · цвет · размер · N шт.» либо свёртка по позициям. */
  summary: string
  cells: string[]
  blockers: MpOrderBlocker[]
  unlinked_offers: string[]
  shortage_qty: number
}

export type MpOrdersResponse = { items: MpOrderListItem[]; total: number; page: number; limit: number }

export type MpOrdersSummary = {
  by_status: Record<string, number>
  overdue_count: number
  no_supply_count: number
  error_count: number
  unlinked_orders_count: number
  unlinked_offers: string[]
  last_sync_at: string | null
  last_sync_ok: boolean | null
  last_sync_error: string | null
}

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
  external_color: string | null
  account_id: string
  account_name: string
  marketplace: Marketplace
  client_id: string
  client_name: string | null
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

export type MpLinkResult = { message: string; barcodes_written: number; barcodes_skipped: number }
export type MpProductsResponse = { items: MpProductItem[]; total: number; page: number; limit: number }

export type MpProductArticleItem = {
  mp_product_id: string
  marketplace: Marketplace
  account_name: string
  offer_id: string | null
  title: string | null
  external_id: string
  external_size: string | null
  external_color: string | null
  variant_id: string | null
  color_name: string | null
  size_name: string | null
  link_source: 'barcode_auto' | 'manual'
  linked_at: string
  linked_by: string | null
}

export type MpProductArticlesResponse = { items: MpProductArticleItem[] }

export type MpOrderListParams = {
  page?: number
  limit?: number
  account_id?: string
  client_id?: string
  marketplace?: string
  status?: string
  overdue?: boolean
  no_supply?: boolean
  has_error?: boolean
  search?: string
}

export type MpProductListParams = {
  account_id?: string
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
  if (params.has_error) sp.set('has_error', 'true')
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
  if (params.account_id) sp.set('account_id', params.account_id)
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.linked && params.linked !== 'all') sp.set('linked', params.linked)
  if (params.search) sp.set('search', params.search)
  return request<MpProductsResponse>(`/marketplaces/products?${sp.toString()}`, { signal })
}

export function getWmsProductMpArticles(productId: string, signal?: AbortSignal) {
  return request<MpProductArticlesResponse>(
    `/marketplaces/wms-products/${productId}/articles`,
    { signal },
  )
}

export function linkMpProduct(mpProductId: string, payload: { product_id: string; variant_id?: string | null }) {
  return request<MpLinkResult>(`/marketplaces/products/${mpProductId}/link`, {
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

export const MP_ORDER_STAGE_LABELS: Record<MpOrderStage, string> = {
  pool: 'Свободный',
  in_supply: 'В поставке',
  packed: 'Упакован',
  handed: 'Передан площадке',
  done: 'Доставлен',
  cancelled: 'Отменён',
}

export function mpOrderStageTone(stage: MpOrderStage): BadgeTone {
  const map: Record<MpOrderStage, BadgeTone> = {
    pool: '',
    in_supply: 'info',
    packed: 'accent',
    handed: 'success',
    done: 'success',
    cancelled: 'danger',
  }
  return map[stage] ?? ''
}

export const MP_ORDER_BLOCKER_LABELS: Record<MpOrderBlocker, string> = {
  unlinked: 'Не связан',
  shortage: 'Нет остатка',
  no_location: 'Без места',
}

/** Один блокер на строку: связка важнее остатка, остаток важнее места хранения. */
export function primaryMpOrderBlocker(item: Pick<MpOrderListItem, 'blockers'>): MpOrderBlocker | null {
  const order: MpOrderBlocker[] = ['unlinked', 'shortage', 'no_location']
  return order.find((b) => item.blockers.includes(b)) ?? null
}

export function isMpOrderOverdue(item: Pick<MpOrderListItem, 'status' | 'deadline_at'>): boolean {
  if (!item.deadline_at) return false
  if (item.status !== 'new' && item.status !== 'in_progress') return false
  return new Date(item.deadline_at).getTime() < Date.now()
}

// --- FBS-поставки ---
export type MpSupplyStatus =
  | 'draft' | 'checking' | 'correcting' | 'picking' | 'packing' | 'handover' | 'done' | 'cancelled'
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
  orders_packed: number
  orders_labeled: number
  orders_cancelled: number
  orders_cancelled_held: number
}

/** Свободные заказы кабинета: очередь, из которой набирают поставки. */
export type MpFreePoolItem = {
  account_id: string
  account_name: string
  marketplace: Marketplace
  client_id: string
  client_name: string | null
  earliest_deadline_at: string | null
  orders_count: number
  total_qty: number
  overdue_count: number
  urgent_count: number
}

export type MpSupplyBoardResponse = {
  items: MpSupplyBoardItem[]
  free_pool: MpFreePoolItem[]
  counters: { supplies: number; orders: number; overdue: number; free_orders: number }
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
  unlinked_offers: string[]
  ready: boolean
  packed_at: string | null
  mp_shipped_at: string | null
  mp_error: string | null
  label_url: string | null
  label_barcode: string | null
  cargo_unit_id: string | null
  cargo_unit_number: string | null
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
  /** Передана площадке: состав зафиксирован, аннулировать нельзя, у WB заведена поставка продавца. */
  mp_transferred_at: string | null
  checking_at: string | null
  correcting_at: string | null
  picking_at: string | null
  packing_at: string | null
  handover_at: string | null
  done_at: string | null
  cargo_units_total: number
  cargo_units_open: number
  return_debt_qty: number
}

export type MpCargoKind = 'box' | 'pallet'
export type MpCargoStatus = 'open' | 'closed'

export type MpCargoOrder = {
  order_id: string
  external_id: string
  label_barcode: string | null
  total_qty: number
  added_at: string | null
}

export type MpCargoUnit = {
  id: string
  supply_id: string
  supply_number: string
  supply_status: MpSupplyStatus
  doc_number: string
  kind: MpCargoKind
  kind_label: string
  status: MpCargoStatus
  external_id: string | null
  closed_at: string | null
  created_at: string
  orders_count: number
  items_qty: number
  orders: MpCargoOrder[]
}

export type MpCargoLabel = {
  id: string
  doc_number: string
  kind_label: string
  supply_number: string
  orders_count: number
  payload: string
  qr_svg: string
}

export type MpSupplyDetail = {
  doc: MpSupplyDoc
  orders: MpSupplyOrderItem[]
  pick_list: MpSupplyPickItem[]
  blockers: MpSupplyBlocker[]
  cargo_units: MpCargoUnit[]
}

export type MpPackLine = {
  line_id: string
  variant_id: string | null
  product_name: string | null
  product_sku: string | null
  color_name: string | null
  size_name: string | null
  offer_id: string | null
  linked: boolean
  need_qty: number
  packed_qty: number
}

export type MpPackOrder = {
  order_id: string
  external_id: string
  order_status: MpOrderStatus
  deadline_at: string | null
  packed_at: string | null
  mp_shipped_at: string | null
  mp_error: string | null
  label_url: string | null
  label_barcode: string | null
  cargo_unit_id: string | null
  cargo_unit_number: string | null
  need_qty: number
  packed_qty: number
  complete: boolean
  lines: MpPackLine[]
}

export type MpPackTableRow = {
  variant_id: string
  product_name: string | null
  product_sku: string | null
  color_name: string | null
  size_name: string | null
  need_qty: number
  picked_qty: number
  packed_qty: number
  on_table_qty: number
}

export type MpSupplyPackView = {
  id: string
  doc_number: string
  status: MpSupplyStatus
  marketplace: Marketplace
  account_name: string
  client_name: string | null
  external_supply_id: string | null
  cutoff_at: string | null
  overdue: boolean
  picker_id: string | null
  picker_name: string | null
  orders_total: number
  orders_packed: number
  orders_labeled: number
  need_qty: number
  packed_qty: number
  can_finish: boolean
  blockers: string[]
  orders: MpPackOrder[]
  table: MpPackTableRow[]
  return_debt_qty: number
  return_items: MpReturnItem[]
  orders_cancelled: number
}

/** Позиция долга возврата: собрано под заказ, которого в составе больше нет. */
export type MpReturnItem = {
  variant_id: string
  product_name: string | null
  product_sku: string | null
  color_name: string | null
  size_name: string | null
  qty: number
}

export type MpPackScanResult = {
  pack_id: string
  order_id: string
  line_id: string
  variant_id: string
  product_name: string | null
  color_name: string | null
  size_name: string | null
  need_qty: number
  packed_qty: number
  order_complete: boolean
  cis_serial: string | null
}

export type MpOrderPushResult = {
  ok: boolean
  error: string | null
  order_id: string
  label_url: string | null
  label_barcode: string | null
}

export type MpSupplyLabelsResult = {
  ok: boolean
  error: string | null
  fetched: number
  labeled: number
  total: number
}

export type MpSupplyOpItem = {
  id: string
  op_type: string
  comment: string | null
  created_at: string
  created_by_name: string | null
}

export type MpSupplyCreatePayload = {
  account_id: string
  /** Пустой состав не заводится: поставку создаёт выбор заказов, а не нажатие кнопки. */
  order_ids: string[]
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

/** Свободные заказы кабинета — из них набирают состав ещё не заведённой поставки. */
export function getMpFreePool(accountId: string, signal?: AbortSignal) {
  const sp = new URLSearchParams({ account_id: accountId })
  return request<{ items: MpSupplyOrderItem[] }>(
    `/marketplaces/supplies/pool?${sp.toString()}`, { signal },
  )
}

/** Свободный пул кабинета в форме строк состава — из него набирают поставку. */
export function getMpSupplyCandidates(supplyId: string, signal?: AbortSignal) {
  return request<{ items: MpSupplyOrderItem[] }>(
    `/marketplaces/supplies/${supplyId}/candidates`, { signal },
  )
}

export function getMpSupplyOps(supplyId: string, signal?: AbortSignal) {
  return request<{ items: MpSupplyOpItem[] }>(`/marketplaces/supplies/${supplyId}/ops`, { signal })
}

/** Завести поставку кабинета: поток заказов делится на столько отгрузок FBS,
 *  на сколько удобно складу. Состав берётся из пула сразу или набирается потом. */
export function createMpSupply(payload: MpSupplyCreatePayload) {
  return request<{ message: string }>('/marketplaces/supplies', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
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

/** «Скорректировать»: состав перевыбирается галочками, как при заведении,
 *  и применяется целиком — либо отбрасывается. */
export function startMpSupplyCorrection(supplyId: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/correct`, { method: 'POST' })
}

export function applyMpSupplyCorrection(supplyId: string, orderIds: string[]) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/correct/apply`, {
    method: 'POST',
    body: JSON.stringify({ order_ids: orderIds }),
  })
}

export function discardMpSupplyCorrection(supplyId: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/correct/discard`, { method: 'POST' })
}

/** «Передать поставку WB / Ozon» — точка невозврата: у WB заводится поставка продавца
 *  со всеми заданиями, у Ozon фиксируется состав. Ответ — номер поставки WB или «ok». */
export function transferMpSupply(supplyId: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/transfer`, { method: 'POST' })
}

// --- Станция упаковки ---

export function getMpSupplyPackView(supplyId: string, signal?: AbortSignal) {
  return request<MpSupplyPackView>(`/marketplaces/supplies/${supplyId}/pack-view`, { signal })
}

export function registerMpPackScan(supplyId: string, orderId: string, code: string, qty = 1) {
  return request<MpPackScanResult>(
    `/marketplaces/supplies/${supplyId}/orders/${orderId}/pack-scans`,
    { method: 'POST', body: JSON.stringify({ code, qty }) },
  )
}

export function undoMpPackScan(supplyId: string, packId: string) {
  return request<{ message: string }>(
    `/marketplaces/supplies/${supplyId}/pack-scans/${packId}/undo`, { method: 'POST' },
  )
}

export function packMpOrder(supplyId: string, orderId: string) {
  return request<MpOrderPushResult>(
    `/marketplaces/supplies/${supplyId}/orders/${orderId}/pack`, { method: 'POST' },
  )
}

export function pushMpOrder(supplyId: string, orderId: string) {
  return request<MpOrderPushResult>(
    `/marketplaces/supplies/${supplyId}/orders/${orderId}/push`, { method: 'POST' },
  )
}

export function unpackMpOrder(supplyId: string, orderId: string) {
  return request<{ message: string }>(
    `/marketplaces/supplies/${supplyId}/orders/${orderId}/unpack`, { method: 'POST' },
  )
}

export function fetchMpSupplyLabels(supplyId: string) {
  return request<MpSupplyLabelsResult>(`/marketplaces/supplies/${supplyId}/labels`, { method: 'POST' })
}

export function finishMpPacking(supplyId: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/finish-packing`, { method: 'POST' })
}

// --- Грузовые места ---

export function getMpCargoUnits(supplyId: string, signal?: AbortSignal) {
  return request<{ items: MpCargoUnit[] }>(`/marketplaces/supplies/${supplyId}/cargo`, { signal })
}

export function createMpCargoUnit(supplyId: string, kind: MpCargoKind) {
  return request<MpCargoUnit>(`/marketplaces/supplies/${supplyId}/cargo`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  })
}

export function getMpCargoLabels(ids: string[], signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('ids', ids.join(','))
  return request<{ items: MpCargoLabel[] }>(`/marketplaces/cargo/labels?${sp.toString()}`, { signal })
}

export function getMpCargoByCode(code: string, signal?: AbortSignal) {
  return request<{ found: boolean; unit: MpCargoUnit | null }>(
    `/marketplaces/cargo/by-code/${encodeURIComponent(code)}`, { signal },
  )
}

export function addMpCargoOrder(cargoId: string, code: string) {
  return request<{ order_id: string; external_id: string; already: boolean; orders_count: number }>(
    `/marketplaces/cargo/${cargoId}/orders`, { method: 'POST', body: JSON.stringify({ code }) },
  )
}

export function removeMpCargoOrder(cargoId: string, orderId: string) {
  return request<{ message: string }>(`/marketplaces/cargo/${cargoId}/orders/${orderId}`, { method: 'DELETE' })
}

export function closeMpCargoUnit(cargoId: string) {
  return request<MpCargoUnit>(`/marketplaces/cargo/${cargoId}/close`, { method: 'POST' })
}

export function reopenMpCargoUnit(cargoId: string) {
  return request<MpCargoUnit>(`/marketplaces/cargo/${cargoId}/reopen`, { method: 'POST' })
}

export function deleteMpCargoUnit(cargoId: string) {
  return request<{ message: string }>(`/marketplaces/cargo/${cargoId}`, { method: 'DELETE' })
}

/** QR грузового места: «wms:gm:<id>». Номер GM-000123 печатается рядом и тоже принимается. */
export const MP_CARGO_QR_PREFIX = 'wms:gm:'

export const MP_CARGO_KIND_LABELS: Record<MpCargoKind, string> = {
  box: 'Короб',
  pallet: 'Палета',
}

export const MP_CARGO_STATUS_LABELS: Record<MpCargoStatus, string> = {
  open: 'Набирается',
  closed: 'Закрыто',
}

export const MP_SUPPLY_STATUS_LABELS: Record<MpSupplyStatus, string> = {
  draft: 'Создание',
  checking: 'Проверка',
  correcting: 'Корректировка',
  picking: 'Сборка',
  packing: 'Упаковка',
  handover: 'Передача',
  done: 'Передана',
  cancelled: 'Аннулирована',
}

/** Подпись главной кнопки фазы — она же индикатор, что сейчас делает менеджер.
 *  На «Проверке» до передачи площадке главная кнопка другая — «Передать поставку WB / Ozon». */
export const MP_SUPPLY_ADVANCE_LABELS: Record<MpSupplyStatus, string> = {
  draft: 'Утвердить состав',
  checking: 'Передать в сборку',
  correcting: 'Сохранить состав',
  picking: 'Собрано, на упаковку',
  packing: 'Упаковано, к передаче',
  handover: 'Передана площадке',
  done: '',
  cancelled: '',
}

export function mpSupplyStatusTone(status: MpSupplyStatus): BadgeTone {
  const map: Record<MpSupplyStatus, BadgeTone> = {
    draft: '',
    checking: 'warning',
    correcting: 'warning',
    picking: 'info',
    packing: 'info',
    handover: 'accent',
    done: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}
