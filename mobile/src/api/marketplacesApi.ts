import { request, requestIdHeaders } from './http'

// --- Types ---

/** Фазы FBS-поставки. На ТСД работает только «Сборка» (picking). */
export type MpSupplyStatus = 'draft' | 'checking' | 'picking' | 'handover' | 'done' | 'cancelled'

export const MP_SUPPLY_STATUS_LABELS: Record<MpSupplyStatus, string> = {
  draft: 'Состав',
  checking: 'Проверка',
  picking: 'Сборка',
  handover: 'Передача',
  done: 'Передана',
  cancelled: 'Аннулирована',
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
}

export type MpSupplyQueue = { queue: number; supply_id: string | null }

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
