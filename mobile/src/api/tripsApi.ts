import { request, requestIdHeaders } from './http'
import { MOSCOW_TZ, moscowNowIso, parseMoscow } from '../utils/format'

// --- Types --- (зеркало backend/modules/logistics/schemas.py)
export type TripDirection = 'inbound' | 'outbound'
export type TripCargoType = 'good' | 'defect'
export type TripStatus = 'draft' | 'awaiting_arrival' | 'unloading' | 'costing' | 'closed' | 'cancelled'
export type TripLoadFactor = 'full' | 'partial'

export type TripDoc = {
  id: string
  trip_number: string
  direction: TripDirection
  cargo_type: TripCargoType
  status: TripStatus
  assignee_role: string | null
  origin_id: string | null
  origin_name: string | null
  carrier_id: string | null
  carrier_name: string | null
  vehicle_type_id: string | null
  vehicle_type_name: string | null
  vehicle_number: string | null
  transport_ordered_at: string | null
  eta: string | null
  cost_estimate: number | null
  comment: string | null
  arrived_at: string | null
  unload_started_at: string | null
  unload_finished_at: string | null
  load_factor: TripLoadFactor | null
  logistics_cost_actual: number | null
  waiting_cost: number | null
  waiting_minutes: number | null
  created_at: string
  created_by: string | null
  updated_at: string | null
}

export type TripReceiptCell = {
  storage_zone_id: string | null
  storage_zone_name: string | null
  qty: number
}

export type TripReceiptAlloc = {
  line_id: string
  product_sku: string | null
  product_name: string | null
  variant: string | null
  qty: number // план этого рейса
  planned_qty: number
  accepted_qty: number // принято всего по всем рейсам
  received_qty: number // принято в этом рейсе (нетто журнала)
  /** Раскладка принятого этим рейсом по ячейкам (нетто журнала). */
  placements: TripReceiptCell[]
  storage_zone_id: string | null
  storage_zone_name: string | null
}

export type TripReceiptItem = {
  line_id: string
  receipt_doc_id: string
  receipt_number: string | null
  receipt_status: string | null
  client_id: string | null
  client_name: string | null
  allocated_qty: number
  received_qty: number
  allocations: TripReceiptAlloc[]
}

export type TripDispatchAlloc = {
  line_id: string
  product_sku: string | null
  product_name: string | null
  variant: string | null
  qty: number // увозит этот рейс
  line_qty: number // план по строке
  shipped_qty: number // отгружено всего (по всем рейсам)
}

export type TripDispatchItem = {
  line_id: string
  dispatch_doc_id: string
  dispatch_number: string | null
  dispatch_status: string | null
  client_id: string | null
  client_name: string | null
  allocated_qty: number
  allocations: TripDispatchAlloc[]
}

export type TripOp = {
  id: string
  trip_id: string
  op_type: string
  comment: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
}

export type TripDetail = {
  doc: TripDoc
  receipts: TripReceiptItem[]
  dispatches: TripDispatchItem[]
  ops: TripOp[]
}

export type TripUnloadPlacement = {
  storage_zone_id?: string | null
  storage_zone_name?: string | null
  qty: number
}

export type TripUnloadReceiptLine = {
  line_id: string
  accepted_qty: number
  storage_zone_id?: string | null
  storage_zone_name?: string | null
  // Раскладка по нескольким ячейкам; accepted_qty = сумме qty. Пусто → одна ячейка.
  placements?: TripUnloadPlacement[]
}

export type TripUnloadPayload = {
  unload_started_at?: string | null
  unload_finished_at?: string | null
  load_factor: TripLoadFactor
  receipt_lines?: TripUnloadReceiptLine[]
}

export type TripListItem = {
  id: string
  trip_number: string
  direction: TripDirection
  cargo_type: TripCargoType
  status: TripStatus
  origin_name: string | null
  carrier_name: string | null
  vehicle_type_name: string | null
  vehicle_number: string | null
  eta: string | null
  arrived_at: string | null
  cost_estimate: number | null
  logistics_cost_actual: number | null
  created_at: string
  receipts_count: number
  items_qty: number
  client_names: string[]
}

export type TripListResponse = { items: TripListItem[]; total: number; page: number; limit: number }

export type TripListParams = {
  page?: number
  limit?: number
  direction?: TripDirection
  status?: string
  statuses?: string[]
  carrier_id?: string
  search?: string
}

// --- Manager payloads ---
export type TripCreatePayload = {
  direction?: TripDirection
  cargo_type?: TripCargoType
  origin_id?: string | null
  origin_name?: string | null
  carrier_id?: string | null
  carrier_name?: string | null
  vehicle_type_id?: string | null
  vehicle_type_name?: string | null
  vehicle_number?: string | null
  transport_ordered_at?: string | null
  eta?: string | null
  cost_estimate?: number | null
  comment?: string | null
  receipt_doc_ids?: string[]
  dispatch_doc_ids?: string[]
}

export type TripUpdatePayload = Omit<TripCreatePayload, 'direction' | 'cargo_type' | 'receipt_doc_ids' | 'dispatch_doc_ids'>

export type TripCostPayload = {
  logistics_cost_actual?: number | null
  waiting_cost?: number | null
  waiting_minutes?: number | null
}

// --- API functions ---
export function getTrips(params: TripListParams = {}, signal?: AbortSignal): Promise<TripListResponse> {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.direction) sp.set('direction', params.direction)
  if (params.status) sp.set('status', params.status)
  if (params.statuses) for (const s of params.statuses) sp.append('statuses', s)
  if (params.carrier_id) sp.set('carrier_id', params.carrier_id)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<TripListResponse>(`/trips${q ? `?${q}` : ''}`, { signal })
}

export function getTrip(tripId: string, signal?: AbortSignal): Promise<TripDetail> {
  return request<TripDetail>(`/trips/${tripId}`, { signal })
}

export function createTrip(payload: TripCreatePayload): Promise<{ message: string }> {
  return request<{ message: string }>('/trips', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateTrip(tripId: string, payload: TripUpdatePayload): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

/** Привязка целиком: пустые allocations = весь остаток документа (зеркало whole-doc на бэке). */
export function linkTripReceipts(tripId: string, receiptDocIds: string[]): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/receipts`, {
    method: 'POST',
    body: JSON.stringify({ items: receiptDocIds.map((id) => ({ receipt_doc_id: id, allocations: [] })) }),
  })
}

export function unlinkTripReceipt(tripId: string, receiptDocId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/receipts/${receiptDocId}`, { method: 'DELETE' })
}

export function linkTripDispatches(tripId: string, dispatchDocIds: string[]): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ items: dispatchDocIds.map((id) => ({ dispatch_doc_id: id, allocations: [] })) }),
  })
}

export function unlinkTripDispatch(tripId: string, dispatchDocId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/dispatches/${dispatchDocId}`, { method: 'DELETE' })
}

export function handoffTrip(tripId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/handoff`, { method: 'POST' })
}

export function tripCost(tripId: string, payload: TripCostPayload): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/cost`, { method: 'POST', body: JSON.stringify(payload) })
}

export function closeTrip(tripId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/close`, { method: 'POST' })
}

export function cancelTrip(tripId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/cancel`, { method: 'POST' })
}

export function tripArrival(tripId: string, arrivedAt: string | null, requestId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/arrival`, {
    method: 'POST',
    body: JSON.stringify({ arrived_at: arrivedAt }),
    headers: requestIdHeaders(requestId),
  })
}

export function tripUnload(tripId: string, payload: TripUnloadPayload, requestId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/unload`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: requestIdHeaders(requestId),
  })
}

/** Корректировка обсчёта приёмки этого рейса по строке поступления (менеджер /
 *  начальник склада): новое принятое рейсом + причина. Дельту по ячейкам разберёт
 *  backend (веб шлёт полную раскладку, мобилка — одно число). */
export function correctTripReceived(
  tripId: string,
  lineId: string,
  payload: { received_qty: number; reason: string },
): Promise<{ message: string }> {
  return request<{ message: string }>(`/trips/${tripId}/receipt-lines/${lineId}/correct-received`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// --- Labels & helpers ---
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  draft: 'Черновик',
  awaiting_arrival: 'Ожидает прибытия',
  unloading: 'Разгрузка',
  costing: 'Уточнение стоимости',
  closed: 'Закрыт',
  cancelled: 'Аннулирован',
}

const TRIP_STATUS_LABELS_OUTBOUND: Record<TripStatus, string> = {
  ...TRIP_STATUS_LABELS,
  unloading: 'Погрузка',
}

export function isOutbound(direction: string | null | undefined): boolean {
  return direction === 'outbound'
}

/** Человекочитаемый статус с учётом направления (для outbound: «Погрузка»). */
export function tripStatusLabel(status: TripStatus, direction: string | null | undefined): string {
  return (isOutbound(direction) ? TRIP_STATUS_LABELS_OUTBOUND : TRIP_STATUS_LABELS)[status]
}

export function tripStatusTone(status: TripStatus): string {
  const map: Record<TripStatus, string> = {
    draft: '',
    awaiting_arrival: 'info',
    unloading: 'warning',
    costing: 'warning',
    closed: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}

export const TRIP_LOAD_LABELS: Record<TripLoadFactor, string> = {
  full: 'Полная',
  partial: 'Неполная',
}

/** Лексика зависит от направления: разгрузка (inbound) vs погрузка (outbound). Зеркало web. */
export function tripLexicon(direction: TripDirection) {
  const outbound = direction === 'outbound'
  return {
    routeLabel: outbound ? 'Куда' : 'Откуда',
    docsTitle: outbound ? 'Отгрузки в рейсе' : 'Поступления в рейсе',
    warehousePhase: outbound ? 'Погрузка' : 'Разгрузка',
    arrivalLabel: 'Прибытие',
    unloadStartLabel: outbound ? 'Начало погрузки' : 'Начало разгрузки',
    unloadEndLabel: outbound ? 'Окончание погрузки' : 'Окончание разгрузки',
    etaLabel: 'Плановое прибытие',
    finishAction: outbound ? 'Завершить погрузку' : 'Завершить разгрузку',
    arrivedAction: outbound ? 'Машина прибыла' : 'Машина приехала',
    progressTitle: outbound ? 'Идёт погрузка' : 'Идёт разгрузка',
    awaitingMachineTitle: 'Ожидает прибытия машины',
    docsInVehicle: 'В машине',
    periodInvalid: outbound
      ? 'Окончание погрузки не может быть раньше начала погрузки.'
      : 'Окончание разгрузки не может быть раньше начала разгрузки.',
  }
}

/** ETA рейса → «21.06, 14:30» по Москве; пусто, если даты нет/она кривая. */
export function fmtEta(eta: string | null | undefined): string {
  if (!eta) return ''
  const d = parseMoscow(eta)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: MOSCOW_TZ,
  })
}

/** Подпись планового времени рейса: приход транспорта (для отгрузки — под погрузку). */
export function tripEtaLabel(_direction: TripDirection): string {
  return 'Прибытие'
}

/** Текущее московское время в формате datetime без таймзоны (как datetime-local в вебе). */
export function nowLocalIso(): string {
  return moscowNowIso()
}
