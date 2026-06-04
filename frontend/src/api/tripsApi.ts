import { request } from './http'

// --- Types ---

export type TripStatus =
  | 'draft'
  | 'awaiting_arrival'
  | 'unloading'
  | 'costing'
  | 'closed'
  | 'cancelled'

export type TripLoadFactor = 'full' | 'partial'

export type TripDirection = 'inbound' | 'outbound'

export type TripDoc = {
  id: string
  trip_number: string
  direction: string
  status: TripStatus
  assignee_role: string | null
  origin_id: string | null
  origin_name: string | null
  carrier_id: string | null
  carrier_name: string | null
  vehicle_type_id: string | null
  vehicle_type_name: string | null
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

export type TripReceiptItem = {
  line_id: string
  receipt_doc_id: string
  receipt_number: string | null
  receipt_status: string | null
  client_id: string | null
  client_name: string | null
}

export type TripShipmentItem = {
  line_id: string
  shipment_doc_id: string
  shipment_number: string | null
  shipment_status: string | null
  client_id: string | null
  client_name: string | null
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
  shipments: TripShipmentItem[]
  ops: TripOp[]
}

export type TripListItem = {
  id: string
  trip_number: string
  direction: string
  status: TripStatus
  origin_name: string | null
  carrier_name: string | null
  vehicle_type_name: string | null
  eta: string | null
  arrived_at: string | null
  cost_estimate: number | null
  logistics_cost_actual: number | null
  created_at: string
  receipts_count: number
}

export type TripListResponse = {
  items: TripListItem[]
  total: number
  page: number
  limit: number
}

export type TripCreatePayload = {
  direction?: TripDirection
  origin_id?: string | null
  origin_name?: string | null
  carrier_id?: string | null
  carrier_name?: string | null
  vehicle_type_id?: string | null
  vehicle_type_name?: string | null
  transport_ordered_at?: string | null
  eta?: string | null
  cost_estimate?: number | null
  comment?: string | null
  receipt_doc_ids?: string[]
  shipment_doc_ids?: string[]
}

export type TripUpdatePayload = Omit<TripCreatePayload, 'receipt_doc_ids'>

export type TripCostPayload = {
  logistics_cost_actual?: number | null
  waiting_cost?: number | null
  waiting_minutes?: number | null
}

export type TripExecutionPayload = {
  arrived_at?: string | null
  unload_started_at?: string | null
  unload_finished_at?: string | null
  load_factor?: TripLoadFactor | null
}

export type TripListParams = {
  page?: number
  limit?: number
  direction?: TripDirection
  status?: TripStatus
  statuses?: TripStatus[]
  carrier_id?: string
  search?: string
  eta_from?: string
  eta_to?: string
}

// --- API functions ---

export function getTrips(params: TripListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.direction) sp.set('direction', params.direction)
  if (params.status) sp.set('status', params.status)
  if (params.statuses) params.statuses.forEach((s) => sp.append('statuses', s))
  if (params.carrier_id) sp.set('carrier_id', params.carrier_id)
  if (params.search) sp.set('search', params.search)
  if (params.eta_from) sp.set('eta_from', params.eta_from)
  if (params.eta_to) sp.set('eta_to', params.eta_to)
  const q = sp.toString()
  return request<TripListResponse>(`/trips${q ? `?${q}` : ''}`, { signal })
}

export function getTrip(tripId: string, signal?: AbortSignal) {
  return request<TripDetail>(`/trips/${tripId}`, { signal })
}

export function createTrip(payload: TripCreatePayload) {
  return request<{ message: string }>('/trips', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTrip(tripId: string, payload: TripUpdatePayload) {
  return request<{ message: string }>(`/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function linkTripReceipts(tripId: string, receiptDocIds: string[]) {
  return request<{ message: string }>(`/trips/${tripId}/receipts`, {
    method: 'POST',
    body: JSON.stringify({ receipt_doc_ids: receiptDocIds }),
  })
}

export function unlinkTripReceipt(tripId: string, receiptDocId: string) {
  return request<{ message: string }>(`/trips/${tripId}/receipts/${receiptDocId}`, {
    method: 'DELETE',
  })
}

export function linkTripShipments(tripId: string, shipmentDocIds: string[]) {
  return request<{ message: string }>(`/trips/${tripId}/shipments`, {
    method: 'POST',
    body: JSON.stringify({ shipment_doc_ids: shipmentDocIds }),
  })
}

export function unlinkTripShipment(tripId: string, shipmentDocId: string) {
  return request<{ message: string }>(`/trips/${tripId}/shipments/${shipmentDocId}`, {
    method: 'DELETE',
  })
}

export function handoffTrip(tripId: string) {
  return request<{ message: string }>(`/trips/${tripId}/handoff`, { method: 'POST' })
}

export function tripArrival(tripId: string, arrivedAt?: string) {
  return request<{ message: string }>(`/trips/${tripId}/arrival`, {
    method: 'POST',
    body: JSON.stringify({ arrived_at: arrivedAt ?? null }),
  })
}

export function tripUnload(tripId: string, payload: { unload_started_at?: string | null; unload_finished_at?: string | null; load_factor?: TripLoadFactor | null }) {
  return request<{ message: string }>(`/trips/${tripId}/unload`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function tripCost(tripId: string, payload: TripCostPayload) {
  return request<{ message: string }>(`/trips/${tripId}/cost`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTripExecution(tripId: string, payload: TripExecutionPayload) {
  return request<{ message: string }>(`/trips/${tripId}/execution`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function closeTrip(tripId: string) {
  return request<{ message: string }>(`/trips/${tripId}/close`, { method: 'POST' })
}

export function cancelTrip(tripId: string) {
  return request<{ message: string }>(`/trips/${tripId}/cancel`, { method: 'POST' })
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
  draft: 'Черновик',
  awaiting_arrival: 'Ожидает прибытия',
  unloading: 'Погрузка',
  costing: 'Уточнение стоимости',
  closed: 'Закрыт',
  cancelled: 'Аннулирован',
}

export function isOutbound(direction: string | null | undefined): boolean {
  return direction === 'outbound'
}

/** Человекочитаемый статус с учётом направления (для outbound: погрузка). */
export function tripStatusLabel(status: TripStatus, direction: string | null | undefined): string {
  return (isOutbound(direction) ? TRIP_STATUS_LABELS_OUTBOUND : TRIP_STATUS_LABELS)[status]
}

/** Лексика, различающаяся по направлению рейса. */
export type TripLexicon = {
  routeLabel: string         // «Откуда» | «Куда»
  docsTitle: string          // «Поступления в рейсе» | «Отгрузки в рейсе»
  docsInVehicle: string      // «В машине» (поступления) | «В машине» (отгрузки)
  warehousePhase: string     // «Разгрузка» | «Погрузка»
  warehousePhaseGen: string  // «разгрузки» | «погрузки» (родительный, нижний регистр)
  arrivalLabel: string       // «Прибытие»
  unloadStartLabel: string   // «Начало разгрузки» | «Начало погрузки»
  unloadEndLabel: string     // «Окончание разгрузки» | «Окончание погрузки»
  etaLabel: string           // «Плановое прибытие»
  finishAction: string       // «Завершить разгрузку» | «Завершить погрузку»
  arrivedAction: string      // «Машина приехала» | «Машина прибыла»
  progressTitle: string      // «Идёт разгрузка» | «Идёт погрузка»
  awaitingMachineTitle: string // «Ожидает прибытия машины»
  periodInvalid: string      // подсказка о порядке времён
}

export function tripLexicon(direction: string | null | undefined): TripLexicon {
  return isOutbound(direction)
    ? {
        routeLabel: 'Куда',
        docsTitle: 'Отгрузки в рейсе',
        docsInVehicle: 'В машине',
        warehousePhase: 'Погрузка',
        warehousePhaseGen: 'погрузки',
        arrivalLabel: 'Прибытие',
        unloadStartLabel: 'Начало погрузки',
        unloadEndLabel: 'Окончание погрузки',
        etaLabel: 'Плановое прибытие',
        finishAction: 'Завершить погрузку',
        arrivedAction: 'Машина прибыла',
        progressTitle: 'Идёт погрузка',
        awaitingMachineTitle: 'Ожидает прибытия машины',
        periodInvalid: 'Окончание погрузки не может быть раньше начала погрузки.',
      }
    : {
        routeLabel: 'Откуда',
        docsTitle: 'Поступления в рейсе',
        docsInVehicle: 'В машине',
        warehousePhase: 'Разгрузка',
        warehousePhaseGen: 'разгрузки',
        arrivalLabel: 'Прибытие',
        unloadStartLabel: 'Начало разгрузки',
        unloadEndLabel: 'Окончание разгрузки',
        etaLabel: 'Плановое прибытие',
        finishAction: 'Завершить разгрузку',
        arrivedAction: 'Машина приехала',
        progressTitle: 'Идёт разгрузка',
        awaitingMachineTitle: 'Ожидает прибытия машины',
        periodInvalid: 'Окончание разгрузки не может быть раньше начала разгрузки.',
      }
}

export const TRIP_LOAD_LABELS: Record<TripLoadFactor, string> = {
  full: 'Полная',
  partial: 'Неполная',
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
