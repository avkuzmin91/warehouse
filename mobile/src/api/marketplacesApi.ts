import { request, requestIdHeaders } from './http'

// --- Types ---

/** Фазы FBS-поставки. На ТСД работают «Сборка», «Упаковка» и грузовые места на «Передаче». */
export type MpSupplyStatus =
  | 'draft' | 'checking' | 'correcting' | 'picking' | 'packing' | 'handover' | 'done' | 'cancelled'

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

export type MpCargoKind = 'box' | 'pallet'
export type MpCargoStatus = 'open' | 'closed'

export const MP_CARGO_KIND_LABELS: Record<MpCargoKind, string> = {
  box: 'Короб',
  pallet: 'Палета',
}

export const MP_CARGO_STATUS_LABELS: Record<MpCargoStatus, string> = {
  open: 'Набирается',
  closed: 'Закрыто',
}

/** QR грузового места: «wms:gm:<id>». Номер GM-000123 печатается рядом и тоже принимается. */
export const MP_CARGO_QR_PREFIX = 'wms:gm:'

export function isCargoCode(raw: string): boolean {
  const s = raw.trim()
  return s.startsWith(MP_CARGO_QR_PREFIX) || /^gm-\d+$/i.test(s)
}

/** Адрес позиции: место хранения и короб, если товар лежит в коробе. */
export type MpSupplyPickCell = {
  zone_id: string | null
  zone_name: string | null
  qty: number
  container_id: string | null
  container_number: string | null
}

export type MpSupplyPickRow = {
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
  locations: MpSupplyPickCell[]
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

export type MpSupplyPickView = {
  id: string
  doc_number: string
  status: MpSupplyStatus
  account_name: string
  client_name: string | null
  cutoff_at: string | null
  overdue: boolean
  orders_total: number
  need_qty: number
  picked_qty: number
  remaining_qty: number
  picker_id: string | null
  picker_name: string | null
  can_finish: boolean
  blockers: string[]
  items: MpSupplyPickRow[]
  return_debt_qty: number
  return_items: MpReturnItem[]
  orders_cancelled: number
}

export type MpSupplyQueue = { queue: number; supply_id: string | null; supply_status: MpSupplyStatus | null }

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
  order_status: string
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
  marketplace: string
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

export type MpPickScanPayload = {
  barcode: string
  zone_id: string
  container_id?: string | null
  qty?: number
}

export type MpPickScanResult = {
  pick_id: string
  variant_id: string
  product_name: string | null
  color_name: string | null
  size_name: string | null
  need_qty: number
  picked_qty: number
  remaining_qty: number
}

export type MpPickReturnPayload = {
  barcode: string
  zone_id: string
  qty?: number
}

export type MpPickReturnResult = {
  variant_id: string
  product_name: string | null
  color_name: string | null
  size_name: string | null
  returned_qty: number
  debt_qty: number
  debt_total_qty: number
}

// --- API functions ---

/** Что покажет кнопка «Получить задачу»: размер очереди и своя незакрытая сборка. */
export function getPickingQueue(signal?: AbortSignal) {
  return request<MpSupplyQueue>('/marketplaces/supplies/queue/next', { signal })
}

export function claimNextSupply(requestId?: string) {
  return request<MpSupplyQueue>('/marketplaces/supplies/claim-next', {
    method: 'POST',
    headers: requestIdHeaders(requestId),
  })
}

export function getSupplyPickView(supplyId: string, signal?: AbortSignal) {
  return request<MpSupplyPickView>(`/marketplaces/supplies/${supplyId}/pick-view`, { signal })
}

export function releaseSupply(supplyId: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/release`, {
    method: 'POST',
  })
}

export function registerSupplyPick(
  supplyId: string, payload: MpPickScanPayload, requestId?: string,
) {
  return request<MpPickScanResult>(`/marketplaces/supplies/${supplyId}/picks`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
    body: JSON.stringify(payload),
  })
}

/** Вернуть на полку собранное под снятые заказы: не откат скана, а адресный возврат. */
export function returnSupplyPick(
  supplyId: string, payload: MpPickReturnPayload, requestId?: string,
) {
  return request<MpPickReturnResult>(`/marketplaces/supplies/${supplyId}/picks/return`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
    body: JSON.stringify(payload),
  })
}

export function undoSupplyPick(supplyId: string, pickId: string) {
  return request<{ message: string }>(
    `/marketplaces/supplies/${supplyId}/picks/${pickId}/undo`, { method: 'POST' },
  )
}

export function finishSupplyPicking(supplyId: string, requestId?: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/finish-picking`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
  })
}

// --- Станция упаковки ---

export function getSupplyPackView(supplyId: string, signal?: AbortSignal) {
  return request<MpSupplyPackView>(`/marketplaces/supplies/${supplyId}/pack-view`, { signal })
}

export function registerPackScan(
  supplyId: string, orderId: string, code: string, requestId?: string,
) {
  return request<MpPackScanResult>(`/marketplaces/supplies/${supplyId}/orders/${orderId}/pack-scans`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
    body: JSON.stringify({ code, qty: 1 }),
  })
}

export function undoPackScan(supplyId: string, packId: string) {
  return request<{ message: string }>(
    `/marketplaces/supplies/${supplyId}/pack-scans/${packId}/undo`, { method: 'POST' },
  )
}

export function packSupplyOrder(supplyId: string, orderId: string, requestId?: string) {
  return request<MpOrderPushResult>(`/marketplaces/supplies/${supplyId}/orders/${orderId}/pack`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
  })
}

export function pushSupplyOrder(supplyId: string, orderId: string) {
  return request<MpOrderPushResult>(
    `/marketplaces/supplies/${supplyId}/orders/${orderId}/push`, { method: 'POST' },
  )
}

export function unpackSupplyOrder(supplyId: string, orderId: string) {
  return request<{ message: string }>(
    `/marketplaces/supplies/${supplyId}/orders/${orderId}/unpack`, { method: 'POST' },
  )
}

export function finishSupplyPacking(supplyId: string, requestId?: string) {
  return request<{ message: string }>(`/marketplaces/supplies/${supplyId}/finish-packing`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
  })
}

// --- Грузовые места ---

export function getCargoUnits(supplyId: string, signal?: AbortSignal) {
  return request<{ items: MpCargoUnit[] }>(`/marketplaces/supplies/${supplyId}/cargo`, { signal })
}

export function createCargoUnit(supplyId: string, kind: MpCargoKind, requestId?: string) {
  return request<MpCargoUnit>(`/marketplaces/supplies/${supplyId}/cargo`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
    body: JSON.stringify({ kind }),
  })
}

export function getCargoByCode(code: string, signal?: AbortSignal) {
  return request<{ found: boolean; unit: MpCargoUnit | null }>(
    `/marketplaces/cargo/by-code/${encodeURIComponent(code)}`, { signal },
  )
}

export function addCargoOrder(cargoId: string, code: string, requestId?: string) {
  return request<{ order_id: string; external_id: string; already: boolean; orders_count: number }>(
    `/marketplaces/cargo/${cargoId}/orders`, {
      method: 'POST',
      headers: requestIdHeaders(requestId),
      body: JSON.stringify({ code }),
    },
  )
}

export function removeCargoOrder(cargoId: string, orderId: string) {
  return request<{ message: string }>(`/marketplaces/cargo/${cargoId}/orders/${orderId}`, { method: 'DELETE' })
}

export function closeCargoUnit(cargoId: string) {
  return request<MpCargoUnit>(`/marketplaces/cargo/${cargoId}/close`, { method: 'POST' })
}

export function reopenCargoUnit(cargoId: string) {
  return request<MpCargoUnit>(`/marketplaces/cargo/${cargoId}/reopen`, { method: 'POST' })
}
