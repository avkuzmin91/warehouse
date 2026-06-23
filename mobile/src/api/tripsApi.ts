import { request, requestIdHeaders } from './http'

// --- Types --- (зеркало backend/modules/logistics/schemas.py)
export type TripDirection = 'inbound' | 'outbound'
export type TripStatus = 'draft' | 'awaiting_arrival' | 'unloading' | 'costing' | 'closed' | 'cancelled'
export type TripLoadFactor = 'full' | 'partial'

export type TripDoc = {
  id: string
  trip_number: string
  direction: TripDirection
  cargo_type: 'good' | 'defect'
  status: TripStatus
  origin_name: string | null
  carrier_name: string | null
  vehicle_type_name: string | null
  vehicle_number: string | null
  transport_ordered_at: string | null
  eta: string | null
  arrived_at: string | null
  unload_started_at: string | null
  unload_finished_at: string | null
  load_factor: TripLoadFactor | null
  comment: string | null
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
  storage_zone_id: string | null
  storage_zone_name: string | null
}

export type TripReceiptItem = {
  line_id: string
  receipt_doc_id: string
  receipt_number: string | null
  receipt_status: string | null
  client_name: string | null
  allocated_qty: number
  received_qty: number
  allocations: TripReceiptAlloc[]
}

export type TripShipmentAlloc = {
  line_id: string
  product_sku: string | null
  product_name: string | null
  variant: string | null
  qty: number
  line_qty: number
  shipped_qty: number
}

export type TripShipmentItem = {
  line_id: string
  shipment_doc_id: string
  shipment_number: string | null
  shipment_status: string | null
  client_name: string | null
  allocated_qty: number
  allocations: TripShipmentAlloc[]
}

export type TripDetail = {
  doc: TripDoc
  receipts: TripReceiptItem[]
  shipments: TripShipmentItem[]
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
  cargo_type: 'good' | 'defect'
  status: TripStatus
  origin_name: string | null
  carrier_name: string | null
  vehicle_number: string | null
  eta: string | null
  arrived_at: string | null
  created_at: string
  receipts_count: number
  items_qty: number
  client_names: string[]
}

export type TripListResponse = { items: TripListItem[]; total: number; page: number; limit: number }

// --- API functions ---
export function getTrips(statuses: string[], limit = 50, signal?: AbortSignal): Promise<TripListResponse> {
  const sp = new URLSearchParams()
  for (const s of statuses) sp.append('statuses', s)
  sp.set('limit', String(limit))
  return request<TripListResponse>(`/trips?${sp.toString()}`, { signal })
}

export function getTrip(tripId: string, signal?: AbortSignal): Promise<TripDetail> {
  return request<TripDetail>(`/trips/${tripId}`, { signal })
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

// --- Labels & helpers ---
export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  draft: 'Черновик',
  awaiting_arrival: 'Ожидает прибытия',
  unloading: 'В работе',
  costing: 'Уточнение стоимости',
  closed: 'Закрыт',
  cancelled: 'Аннулирован',
}

export const TRIP_LOAD_LABELS: Record<TripLoadFactor, string> = {
  full: 'Полная',
  partial: 'Неполная',
}

/** Лексика зависит от направления: разгрузка (inbound) vs погрузка (outbound). Зеркало web. */
export function tripLexicon(direction: TripDirection) {
  const outbound = direction === 'outbound'
  return {
    warehousePhase: outbound ? 'Погрузка' : 'Разгрузка',
    arrivalLabel: 'Прибытие',
    unloadStartLabel: outbound ? 'Начало погрузки' : 'Начало разгрузки',
    unloadEndLabel: outbound ? 'Окончание погрузки' : 'Окончание разгрузки',
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

/** ETA рейса → «21.06, 14:30» в локальной зоне; пусто, если даты нет/она кривая. */
export function fmtEta(eta: string | null | undefined): string {
  if (!eta) return ''
  const d = new Date(eta)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Подпись планового времени рейса: приход транспорта (для отгрузки — под погрузку). */
export function tripEtaLabel(_direction: TripDirection): string {
  return 'Прибытие'
}

/** Локальное время в формате datetime без таймзоны (как datetime-local в вебе). */
export function nowLocalIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
