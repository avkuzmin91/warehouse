import { request, requestForm } from './http'
import { moscowTodayYmd } from '../utils/format'
import type { DuplicateCheckResponse } from './domainTypes'

export type ShipmentStatus = 'draft' | 'assigned' | 'packing' | 'on_packing' | 'relocating' | 'packed' | 'awaiting_trip' | 'partially_shipped' | 'shipped' | 'completed_no_goods' | 'cancelled'

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft:             'Черновик',
  assigned:          'Ожидает принятия',
  packing:           'В плане',
  on_packing:        'На упаковке',
  relocating:        'Перемещение',
  packed:            'Упакован',
  awaiting_trip:     'Ожидает рейс',
  partially_shipped: 'Частично отгружено',
  shipped:           'Завершён',
  completed_no_goods: 'Завершён',
  cancelled:         'Аннулирован',
}

export const SHIPMENT_STEP_DONE_LABELS: Record<ShipmentStatus, string> = {
  draft:             'Создан',
  assigned:          'Принята',
  packing:           'Передан на упаковку',
  on_packing:        'Упакован',
  relocating:        'Передан кладовщику',
  packed:            'Упакован',
  awaiting_trip:     'Готов к рейсу',
  partially_shipped: 'Частично отгружено',
  shipped:           'Завершён',
  completed_no_goods: 'Завершён',
  cancelled:         'Аннулирован',
}

export const SHIPMENT_STATUS_TONES: Record<ShipmentStatus, string> = {
  draft:             '',
  assigned:          'warning',
  packing:           'info',
  on_packing:        'info',
  relocating:        'info',
  packed:            'success',
  awaiting_trip:     'warning',
  partially_shipped: 'warning',
  shipped:           'success',
  completed_no_goods: 'warning',
  cancelled:         'danger',
}

export const SHIPMENT_STATUS_ORDER: ShipmentStatus[] = [
  'draft', 'assigned', 'packing', 'on_packing', 'relocating', 'packed',
]

// Приоритет — уровень срочности: 1 «Срочно», 2 «Повышенный», null «Обычный».
export const SHIPMENT_PRIORITY_URGENT = 1
export const SHIPMENT_PRIORITY_HIGH   = 2

export const SHIPMENT_PRIORITY_LABELS: Record<number, string> = {
  [SHIPMENT_PRIORITY_URGENT]: 'Срочно',
  [SHIPMENT_PRIORITY_HIGH]:   'Повышенный',
}

export function shipmentPriorityLabel(rank: number | null): string {
  return (rank != null && SHIPMENT_PRIORITY_LABELS[rank]) || 'Обычный'
}

export function shipmentPriorityTone(rank: number | null): 'danger' | 'warning' | '' {
  if (rank === SHIPMENT_PRIORITY_URGENT) return 'danger'
  if (rank === SHIPMENT_PRIORITY_HIGH) return 'warning'
  return ''
}

export type ShipmentCargoType = 'good' | 'defect'

export type ShipmentOpType =
  | 'doc_create' | 'advance' | 'revert' | 'cancel' | 'doc_update' | 'priority_update'
  | 'pack' | 'pack_correction' | 'move_return' | 'relocate' | 'return_to_packing' | 'reject'
  | 'repack_start' | 'repack_charge'

// Переупаковка (задача была поставлена с ошибкой, товар пакуется заново):
// free — за наш счёт (объём в производительности виден, деньги 0),
// paid — за счёт клиента (при завершении задачи автосоздаётся запись «Доп. работы»).
export type ShipmentRepackKind = 'free' | 'paid'

export const SHIPMENT_REPACK_KIND_LABELS: Record<ShipmentRepackKind, string> = {
  free: 'Переупаковка без оплаты',
  paid: 'Переупаковка за счёт клиента',
}

export type ShipmentOp = {
  id:               string
  op_type:          ShipmentOpType
  comment:          string | null
  created_at:       string
  created_by:       string | null
  created_by_email: string | null
}

export type ShipmentLineFile = {
  id:         string
  filename:   string
  url:        string
  mime_type:  string | null
  created_at: string
}

export type ShipmentLinePlacement = {
  kind:      'good' | 'defect'
  zone_id:   string | null
  zone_name: string | null
  qty:       number
}

export type ShipmentLine = {
  id:                string
  product_id:        string
  product_name:      string
  product_sku:       string
  sku_pending:       boolean
  color_id:          string | null
  color_name:        string | null
  size_id:           string | null
  size_name:         string | null
  qty:               number
  shipped_qty:       number
  packed_good:       number
  packed_defect:     number
  // Упаковано, но ещё не размещено по местам (корзина packed). Размещённое в ready
  // частичным «Разместить готовое» сюда не входит — оно уже доступно к отгрузке.
  packed_pending_good:   number
  packed_pending_defect: number
  available_for_pack: number
  storage_zone_id:   string | null
  storage_zone_name: string | null
  store_id:          string | null
  store_name:        string | null
  placements:        ShipmentLinePlacement[]
  files:             ShipmentLineFile[]
}

export type ShipmentListItem = {
  id:             string
  doc_number:     string
  cargo_type:     ShipmentCargoType
  client_id:      string | null
  client_name:    string | null
  destination:    string | null
  carrier:        string | null
  logistics_cost: number | null
  ship_date:      string | null
  priority_rank:  number | null
  status:         ShipmentStatus
  status_label:   string
  sku_count:      number
  total_qty:      number
  total_shipped_qty?: number
  total_packed_qty?: number
  /** Свободный к распределению остаток: готовый к отгрузке (по качеству груза) минус
   *  уже зарезервированное в активные ещё-не-уехавшие рейсы. Совпадает с `max` строк
   *  в модале распределения (см. shipment_alloc_remaining на бэкенде). */
  total_free_qty?: number
  lines_with_shipped_qty?: number
  lines_with_packed_qty?: number
  lines_with_zone?: number
  created_at:     string
  created_by_name?: string | null
}

export type ShipmentDetail = ShipmentListItem & {
  comment:          string | null
  actual_ship_date: string | null
  trip_id?:         string | null
  trip_number?:     string | null
  trips?:           { id: string; number: string }[]
  // Переупаковка: kind остаётся после завершения (бейдж «была переупакована»),
  // repack_active=true — пока пакуют заново. Денежные поля видят только роли со стоимостями.
  repack_kind:      ShipmentRepackKind | null
  repack_reason:    string | null
  repack_active:    boolean
  repack_price_kop:        number | null
  repack_extra_amount_kop: number | null
  repack_extra_comment:    string | null
  created_by:       string | null
  created_by_name:  string | null
  updated_at:       string | null
  lines:            ShipmentLine[]
  ops:              ShipmentOp[]
  total_qty:        number
}

export type ShipmentListResponse = {
  items: ShipmentListItem[]
  total: number
  page:  number
  limit: number
}

export type ShipmentLinesListItem = {
  line_id:           string
  doc_id:            string
  doc_number:        string
  cargo_type:        ShipmentCargoType
  client_id:         string | null
  client_name:       string | null
  destination:       string | null
  ship_date:         string | null
  status:            ShipmentStatus
  status_label:      string
  product_id:        string
  product_name:      string
  product_sku:       string
  color_name:        string | null
  size_name:         string | null
  qty:               number
  shipped_qty:       number
  packed_good?:      number
  storage_zone_name: string | null
  store_name:        string | null
}

export type ShipmentLinesResponse = {
  items: ShipmentLinesListItem[]
  total: number
  page:  number
  limit: number
}

export type ShipmentListParams = {
  page?:      number
  limit?:     number
  /** Один статус или массив (бэкенд принимает CSV для status IN (...)). */
  status?:    ShipmentStatus | ShipmentStatus[]
  client_id?: string
  search?:    string
  sku?:       string
  date_from?: string
  date_to?:   string
  overdue?:   boolean
  cargo_type?: ShipmentCargoType
}

export type ShipmentsSummary = {
  all:     number
  done:    number
  packing: number
  overdue: number
}

export function isShipmentOverdue(item: ShipmentListItem): boolean {
  if (!item.ship_date) return false
  if (item.status !== 'packing') return false
  return item.ship_date < moscowTodayYmd()
}

export type ShipmentLineIn = {
  product_id:         string
  product_name:       string
  product_sku:        string
  color_id?:          string | null
  color_name?:        string | null
  size_id?:           string | null
  size_name?:         string | null
  qty:                number
  shipped_qty?:       number
  storage_zone_id?:   string | null
  storage_zone_name?: string | null
  store_id?:          string | null
  store_name?:        string | null
}

export type ShipmentDocCreate = {
  cargo_type?:     ShipmentCargoType
  client_id?:      string | null
  client_name?:    string | null
  destination?:    string | null
  carrier?:        string | null
  logistics_cost?: number | null
  ship_date?:      string | null
  comment?:        string | null
  lines?:          ShipmentLineIn[]
}

export type ShipmentDocUpdate = Omit<ShipmentDocCreate, 'lines'> & {
  priority_rank?: number | null
  actual_ship_date?: string | null
}

export function getShipmentsSummary(params: Pick<ShipmentListParams, 'client_id' | 'search' | 'sku' | 'date_from' | 'date_to'> = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
  if (params.sku)       sp.set('sku', params.sku)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to)   sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<ShipmentsSummary>(`/shipments/summary${q ? `?${q}` : ''}`, { signal })
}

export function listShipments(params: ShipmentListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page)      sp.set('page', String(params.page))
  if (params.limit)     sp.set('limit', String(params.limit))
  if (params.status) {
    sp.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status)
  }
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
  if (params.sku)       sp.set('sku', params.sku)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to)   sp.set('date_to', params.date_to)
  if (params.overdue)   sp.set('overdue', 'true')
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  const q = sp.toString()
  return request<ShipmentListResponse>(`/shipments${q ? `?${q}` : ''}`, { signal })
}

export function listShipmentLines(params: ShipmentListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page)      sp.set('page', String(params.page))
  if (params.limit)     sp.set('limit', String(params.limit))
  if (params.status) {
    sp.set('status', Array.isArray(params.status) ? params.status.join(',') : params.status)
  }
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
  if (params.sku)       sp.set('sku', params.sku)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to)   sp.set('date_to', params.date_to)
  if (params.overdue)   sp.set('overdue', 'true')
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  const q = sp.toString()
  return request<ShipmentLinesResponse>(`/shipments/lines${q ? `?${q}` : ''}`, { signal })
}

export function getShipment(id: string, signal?: AbortSignal) {
  return request<ShipmentDetail>(`/shipments/${id}`, { signal })
}

export function createShipment(body: ShipmentDocCreate) {
  return request<{ message: string }>('/shipments', { method: 'POST', body: JSON.stringify(body), idempotent: true })
}

export type ShipmentDuplicateCheckPayload = {
  cargo_type: ShipmentCargoType
  client_id: string
  ship_date?: string | null
  lines: { product_id: string; color_id?: string | null; size_id?: string | null; qty: number }[]
}

export function checkShipmentDuplicate(payload: ShipmentDuplicateCheckPayload) {
  return request<DuplicateCheckResponse>('/shipments/check-duplicate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateShipment(id: string, body: ShipmentDocUpdate) {
  return request<{ message: string }>(`/shipments/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function updateShipmentPriority(id: string, priorityRank: number | null) {
  // Выделенный эндпоинт: общий PATCH разрешён только в draft/packing,
  // а приоритет редактируется до самой отправки.
  return request<{ message: string }>(`/shipments/${id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority_rank: priorityRank }),
  })
}

export function addShipmentLine(docId: string, line: ShipmentLineIn) {
  return request<{ message: string }>(`/shipments/${docId}/lines`, { method: 'POST', body: JSON.stringify(line) })
}

export function updateShipmentLine(docId: string, lineId: string, line: ShipmentLineIn) {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(line) })
}

export function updateShipmentLineStore(docId: string, lineId: string, storeId: string | null) {
  // Узкая корректировка магазина: в отличие от общего line-PATCH разрешена и в «На упаковке».
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}/store`, {
    method: 'PATCH',
    body: JSON.stringify({ store_id: storeId }),
  })
}

export function deleteShipmentLine(docId: string, lineId: string) {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}`, { method: 'DELETE' })
}

export type PackingPayload = { good_delta?: number; defect_delta?: number; packed_date: string }

export function recordPacking(docId: string, lineId: string, payload: PackingPayload) {
  return request<{ message: string; packed_good: number; packed_defect: number }>(
    `/shipments/${docId}/lines/${lineId}/pack`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

export type ShipmentPackingEntry = {
  id:               string
  packed_date:      string | null
  good:             number
  defect:           number
  created_at:       string
  created_by:       string | null
  created_by_email: string | null
  repack_kind?:     ShipmentRepackKind | null
  reversed:         boolean
}

export type ShipmentPackingResponse = {
  plan:               number
  available_for_pack: number
  packed_good:        number
  packed_defect:      number
  entries:            ShipmentPackingEntry[]
}

export function getLinePacking(docId: string, lineId: string, signal?: AbortSignal) {
  return request<ShipmentPackingResponse>(`/shipments/${docId}/lines/${lineId}/packing`, { signal })
}

export function reversePackingEntry(docId: string, lineId: string, entryId: string) {
  return request<{ message: string; packed_good: number; packed_defect: number }>(
    `/shipments/${docId}/lines/${lineId}/packing/${entryId}/reverse`,
    { method: 'POST' },
  )
}

export type PackingProductivityRow = {
  client_id:    string | null
  client_name:  string | null
  product_id:   string
  product_sku:  string | null
  product_name: string | null
  good:         number
  defect:       number
  total:        number
  good_earn_kop:   number
  defect_earn_kop: number
  earn_kop:        number
  price_missing:   boolean
  repack_kind?:    ShipmentRepackKind | null
  doc_ids:         string[]
}

export type PackingProductivityDay = {
  packed_date: string
  good:        number
  defect:      number
  total:       number
  sku_count:   number
  doc_count:   number
  good_earn_kop:   number
  defect_earn_kop: number
  earn_kop:        number
  rows:        PackingProductivityRow[]
}

export type PackingProductivityResponse = {
  days:         PackingProductivityDay[]
  total_good:   number
  total_defect: number
  total:        number
  total_good_earn_kop:   number
  total_defect_earn_kop: number
  total_earn_kop:        number
  with_earnings:         boolean
}

export type PackingProductivityParams = {
  date_from?: string
  date_to?:   string
  client_id?: string
  search?:    string
}

export function getPackingProductivity(params: PackingProductivityParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to)   sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
  const q = sp.toString()
  return request<PackingProductivityResponse>(`/shipments/packing/productivity${q ? `?${q}` : ''}`, { signal })
}

export type PackingDayLine = {
  product_id:    string
  product_sku:   string | null
  product_name:  string | null
  good:          number
  defect:        number
  total:         number
  earn_kop:      number
  price_missing: boolean
  repack_kind?:  ShipmentRepackKind | null
}

export type PackingDayDoc = {
  doc_id:        string
  doc_number:    string
  status:        string
  client_id:     string | null
  client_name:   string | null
  good:          number
  defect:        number
  total:         number
  earn_kop:      number
  price_missing: boolean
  lines:         PackingDayLine[]
}

export type PackingDayResponse = {
  packed_date:   string
  good:          number
  defect:        number
  total:         number
  earn_kop:      number
  with_earnings: boolean
  docs:          PackingDayDoc[]
}

export function getPackingDay(
  params: { date: string; client_id?: string },
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  sp.set('date', params.date)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<PackingDayResponse>(
    `/shipments/packing/productivity/day?${sp.toString()}`,
    { signal },
  )
}

export type ProductivityPackEntry = {
  id:               string
  packed_date:      string | null
  good:             number
  defect:           number
  created_at:       string
  created_by_email: string | null
  doc_id:           string | null
  doc_number:       string | null
  reversed:         boolean
}

export function getProductivityEntries(
  params: { packed_date: string; product_id: string; client_id?: string | null },
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  sp.set('packed_date', params.packed_date)
  sp.set('product_id', params.product_id)
  if (params.client_id) sp.set('client_id', params.client_id)
  return request<{ entries: ProductivityPackEntry[] }>(
    `/shipments/packing/productivity/entries?${sp.toString()}`,
    { signal },
  )
}

export function movePackingDate(payload: { entry_ids: string[]; new_date: string }) {
  return request<{ moved: number }>('/shipments/packing/productivity/move-date', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export type ShipmentMoveAllocation = { from_zone_id: string | null; qty: number }

export function moveShipmentLineToPacking(docId: string, lineId: string, allocations: ShipmentMoveAllocation[]) {
  return request<{ message: string; moved: number }>(
    `/shipments/${docId}/lines/${lineId}/move-to-packing`,
    { method: 'POST', body: JSON.stringify({ allocations }) },
  )
}

export function returnShipmentLineFromPacking(docId: string, lineId: string, qty?: number) {
  return request<{ message: string; returned: number }>(
    `/shipments/${docId}/lines/${lineId}/return-from-packing`,
    { method: 'POST', body: JSON.stringify({ qty: qty ?? null }) },
  )
}

export function advanceShipment(id: string) {
  return request<{ message: string }>(`/shipments/${id}/advance`, { method: 'POST' })
}

// Отклонить задачу упаковки на приёмке (assigned → draft) с причиной — возврат менеджеру.
export function rejectShipment(id: string, reason: string) {
  return request<{ message: string }>(`/shipments/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}

// Менеджерский возврат товарной задачи упаковки «на упаковку» (из «Перемещение» или
// «Упаковано»). Для «Упаковано» бэкенд откатывает раскладку по местам.
// mode: rework — обычная доработка; repack_free/repack_paid — переупаковка (reason
// обязателен; для paid — unit_price_kop кастомная цена за единицу либо null =
// стандартный тариф, extra_amount_kop/extra_comment — работы сверх тарифа).
// force=true — частичный возврат: уже отгруженное с места остаётся вне задачи,
// на упаковку возвращается только физически доступный остаток.
export type ReturnToPackingPayload = {
  mode?: 'rework' | 'repack_free' | 'repack_paid'
  reason?: string
  unit_price_kop?: number | null
  extra_amount_kop?: number | null
  extra_comment?: string | null
  force?: boolean
}

export function returnShipmentToPacking(id: string, payload: ReturnToPackingPayload = {}) {
  return request<{ message: string }>(`/shipments/${id}/return-to-packing`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'rework', ...payload }),
  })
}

export type ShipmentRelocateAllocation = { zone_id: string; zone_name: string | null; qty: number }
export type ShipmentRelocateLine = {
  line_id: string
  good:    ShipmentRelocateAllocation[]
  defect:  ShipmentRelocateAllocation[]
}

export function finishShipmentRelocation(id: string, lines: ShipmentRelocateLine[]) {
  return request<{ message: string }>(`/shipments/${id}/finish-relocation`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
  })
}

// Частичное размещение упакованного годного по местам, не завершая упаковку: делает
// упакованное доступным к отгрузке (ready) во время многодневной упаковки. Нужны только good.
export function placePackedShipment(id: string, lines: ShipmentRelocateLine[]) {
  return request<{ message: string; moved: number }>(`/shipments/${id}/place-packed`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
  })
}

export type ShipmentDefectSourceAllocation = { zone_id: string; zone_name: string | null; qty: number }
export type ShipmentDefectRelocateLine = {
  line_id: string
  sources: ShipmentDefectSourceAllocation[]
}

export function finishShipmentDefectRelocation(id: string, lines: ShipmentDefectRelocateLine[]) {
  return request<{ message: string }>(`/shipments/${id}/finish-defect-relocation`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
  })
}

export function cancelShipment(id: string) {
  return request<{ message: string }>(`/shipments/${id}/cancel`, { method: 'POST' })
}

export function deleteShipment(id: string) {
  return request<{ message: string }>(`/shipments/${id}`, { method: 'DELETE' })
}

export function uploadShipmentLineFile(docId: string, lineId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return requestForm<{ message: string }>(`/shipments/${docId}/lines/${lineId}/files`, {
    method: 'POST',
    body: form,
  })
}

export function deleteShipmentLineFile(docId: string, lineId: string, fileId: string) {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}/files/${fileId}`, {
    method: 'DELETE',
  })
}
