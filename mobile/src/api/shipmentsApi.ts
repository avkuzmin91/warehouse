import { request, requestForm, requestIdHeaders } from './http'

// --- Types --- (зеркало backend/modules/shipments/schemas.py)
export type ShipmentStatus =
  | 'draft'
  | 'packing'
  | 'on_packing'
  | 'relocating'
  | 'packed'
  | 'awaiting_trip'
  | 'partially_shipped'
  | 'shipped'
  | 'completed_no_goods'
  | 'cancelled'

export type ShipmentPlacement = { kind: 'good' | 'defect'; zone_id: string | null; zone_name: string | null; qty: number }

export type ShipmentLineFile = {
  id: string
  filename: string
  url: string
  mime_type: string | null
  barcodes: string[]
  // Коды со статусом относительно варианта строки — как в frontend/src/api/shipmentsApi.ts.
  barcode_details: LineFileBarcode[]
  created_at: string
}

export type ShipmentLine = {
  id: string
  product_id: string
  product_name: string
  product_sku: string
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  qty: number
  shipped_qty: number
  packed_good: number
  packed_defect: number
  // Упаковано, но ещё не размещено по местам (корзина packed). Размещённое в ready
  // частичным «Разместить готовое» сюда не входит — оно уже доступно к отгрузке.
  packed_pending_good: number
  packed_pending_defect: number
  available_for_pack: number
  store_id: string | null
  store_name: string | null
  placements: ShipmentPlacement[]
  files: ShipmentLineFile[]
}

// Переупаковка (задача была поставлена с ошибкой, товар пакуется заново):
// free — за наш счёт (объём в производительности виден, деньги 0),
// paid — за счёт клиента (при завершении задачи автосоздаётся запись «Доп. работы»).
export type ShipmentRepackKind = 'free' | 'paid'

export const SHIPMENT_REPACK_KIND_LABELS: Record<ShipmentRepackKind, string> = {
  free: 'Переупаковка без оплаты',
  paid: 'Переупаковка за счёт клиента',
}

export type ShipmentDetail = {
  id: string
  doc_number: string
  cargo_type: 'good' | 'defect'
  client_id: string | null
  client_name: string | null
  destination: string | null
  carrier: string | null
  ship_date: string | null
  priority_rank: number | null
  comment: string | null
  status: ShipmentStatus
  status_label: string
  // Переупаковка: kind остаётся после завершения (бейдж), repack_active — пока пакуют заново.
  repack_kind: ShipmentRepackKind | null
  repack_reason: string | null
  repack_active: boolean
  lines: ShipmentLine[]
}

export type ShipmentListItem = {
  id: string
  doc_number: string
  cargo_type: 'good' | 'defect'
  client_name: string | null
  ship_date: string | null
  status: ShipmentStatus
  status_label: string
  sku_count: number
  total_qty: number
  priority_rank: number | null
}

export type ShipmentListResponse = { items: ShipmentListItem[]; total: number; page: number; limit: number }

// --- API functions ---
export function getShipments(status: string, limit = 50, signal?: AbortSignal): Promise<ShipmentListResponse> {
  const sp = new URLSearchParams()
  sp.set('status', status)
  sp.set('limit', String(limit))
  return request<ShipmentListResponse>(`/shipments?${sp.toString()}`, { signal })
}

export function getShipment(id: string, signal?: AbortSignal): Promise<ShipmentDetail> {
  return request<ShipmentDetail>(`/shipments/${id}`, { signal })
}

export type ShipmentListParams = {
  page?: number
  limit?: number
  status?: string
  client_id?: string
  search?: string
  cargo_type?: 'good' | 'defect'
}

export type ShipmentLineIn = {
  product_id: string
  product_name: string
  product_sku: string
  color_id?: string | null
  color_name?: string | null
  size_id?: string | null
  size_name?: string | null
  qty: number
  storage_zone_id?: string | null
  storage_zone_name?: string | null
  store_id?: string | null
  store_name?: string | null
}

export type ShipmentDocCreate = {
  cargo_type?: 'good' | 'defect'
  client_id?: string | null
  client_name?: string | null
  ship_date?: string | null
  comment?: string | null
  lines?: ShipmentLineIn[]
}

export function createShipment(body: ShipmentDocCreate): Promise<{ message: string }> {
  return request<{ message: string }>('/shipments', { method: 'POST', body: JSON.stringify(body) })
}

export type ShipmentDocUpdate = {
  cargo_type?: 'good' | 'defect'
  client_id?: string | null
  client_name?: string | null
  ship_date?: string | null
  comment?: string | null
}

// Правка черновика/плана: PATCH шлёт только заполненные поля (бэк exclude_unset).
export function updateShipment(id: string, body: ShipmentDocUpdate): Promise<{ message: string }> {
  return request<{ message: string }>(`/shipments/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function addShipmentLine(docId: string, body: ShipmentLineIn): Promise<{ message: string }> {
  return request<{ message: string }>(`/shipments/${docId}/lines`, { method: 'POST', body: JSON.stringify(body) })
}

export function updateShipmentLine(docId: string, lineId: string, body: ShipmentLineIn): Promise<{ message: string }> {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteShipmentLine(docId: string, lineId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}`, { method: 'DELETE' })
}

// Распознавание ШК на загруженном файле строки: confirmed — код привязан к варианту
// строки, unknown — кода нет в системе (кандидат на привязку), other_variant — код
// другого цвето-размера того же товара (вероятный пересорт), other_product — чужой товар.
export type LineFileBarcodeStatus = 'confirmed' | 'unknown' | 'other_variant' | 'other_product'
export type LineFileBarcode = {
  code: string
  status: LineFileBarcodeStatus
  other_product_name: string | null
  other_variant_label: string | null
}
// line_variant_id — вариант строки (товар+цвет+размер): к нему привязываются новые коды.
export type LineFileUploadResult = { message: string; line_variant_id: string | null; barcodes: LineFileBarcode[] }

export function uploadShipmentLineFile(docId: string, lineId: string, file: File): Promise<LineFileUploadResult> {
  const form = new FormData()
  form.append('file', file)
  return requestForm<LineFileUploadResult>(`/shipments/${docId}/lines/${lineId}/files`, { method: 'POST', body: form })
}

export function deleteShipmentLineFile(docId: string, lineId: string, fileId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}/files/${fileId}`, { method: 'DELETE' })
}

// Прикрепить этикетку из карточки товара к строке (без повторной загрузки файла).
export function attachShipmentLineFileFromProduct(docId: string, lineId: string, productFileId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/shipments/${docId}/lines/${lineId}/files/from-product`, {
    method: 'POST',
    body: JSON.stringify({ product_file_id: productFileId }),
  })
}

// Менеджерский список «Задач упаковки»: пагинация + фильтры (status опционален → все статусы).
export function listShipments(params: ShipmentListParams = {}, signal?: AbortSignal): Promise<ShipmentListResponse> {
  const sp = new URLSearchParams()
  if (params.page)       sp.set('page', String(params.page))
  if (params.limit)      sp.set('limit', String(params.limit))
  if (params.status)     sp.set('status', params.status)
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  const q = sp.toString()
  return request<ShipmentListResponse>(`/shipments${q ? `?${q}` : ''}`, { signal })
}

export type MoveAllocation = { from_zone_id: string | null; qty: number }

// Передача на упаковку: явная разбивка по зонам-источникам (как в вебе).
export function moveLineToPacking(docId: string, lineId: string, allocations: MoveAllocation[], requestId: string) {
  return request<{ message: string; moved: number }>(`/shipments/${docId}/lines/${lineId}/move-to-packing`, {
    method: 'POST',
    body: JSON.stringify({ allocations }),
    headers: requestIdHeaders(requestId),
  })
}

// Откат ошибочной передачи на упаковку: товар возвращается в исходные места хранения.
export function returnLineFromPacking(docId: string, lineId: string, qty?: number) {
  return request<{ message: string; returned: number }>(`/shipments/${docId}/lines/${lineId}/return-from-packing`, {
    method: 'POST',
    body: JSON.stringify({ qty: qty ?? null }),
  })
}

// Продвижение по плановому переходу: draft → packing (менеджер ставит задачу),
// packing → on_packing (передать начальнику смены) и т.д.
export function advanceShipment(id: string, requestId: string) {
  return request<{ message: string }>(`/shipments/${id}/advance`, {
    method: 'POST',
    headers: requestIdHeaders(requestId),
  })
}

export function updateShipmentPriority(id: string, priorityRank: number | null) {
  // Выделенный эндпоинт: общий PATCH разрешён только в draft/packing,
  // а приоритет редактируется до самой отправки.
  return request<{ message: string }>(`/shipments/${id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority_rank: priorityRank }),
  })
}

// Аннулирование: годный — до передачи на упаковку включительно (в «На упаковке» — пока
// ничего не упаковано), брак — draft/relocating/awaiting_trip (гейты бэка).
export function cancelShipment(id: string) {
  return request<{ message: string }>(`/shipments/${id}/cancel`, { method: 'POST' })
}

// Менеджерский возврат товарной задачи упаковки «на упаковку» (из «Перемещение» или
// «Упаковано»). Для «Упаковано» бэкенд откатывает раскладку по местам.
// force=true — частичный возврат: уже отгруженное с места остаётся вне задачи,
// на упаковку возвращается только физически доступный остаток.
// mode: rework — обычная доработка; repack_free/repack_paid — переупаковка (reason
// обязателен; для paid — unit_price_kop кастомная цена за единицу либо null =
// стандартный тариф, extra_amount_kop/extra_comment — работы сверх тарифа).
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

export type RelocateAllocation = { zone_id: string; zone_name: string | null; qty: number }
export type RelocateLine = { line_id: string; good: RelocateAllocation[]; defect: RelocateAllocation[] }

// relocating → awaiting_trip (раскладка годного/брака по местам).
export function finishRelocation(id: string, lines: RelocateLine[], requestId: string) {
  return request<{ message: string }>(`/shipments/${id}/finish-relocation`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
    headers: requestIdHeaders(requestId),
  })
}

// Частичное размещение упакованного годного по местам, не завершая упаковку (отгрузка
// из ещё не упакованной до конца задачи): packed→ready, статус остаётся on_packing.
// Нужны только аллокации good.
export function placePackedShipment(id: string, lines: RelocateLine[], requestId: string) {
  return request<{ message: string; moved: number }>(`/shipments/${id}/place-packed`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
    headers: requestIdHeaders(requestId),
  })
}

export type ShipmentDefectSourceAllocation = { zone_id: string; zone_name: string | null; qty: number }
export type ShipmentDefectRelocateLine = { line_id: string; sources: ShipmentDefectSourceAllocation[] }

// Брак-отгрузка: relocating → awaiting_trip. Брак собирается из мест хранения
// (storage/defect) и переезжает в зону отгрузки. Ретрай безопасен: повтор после
// смены статуса отклоняется серверным гейтом перехода.
export function finishShipmentDefectRelocation(id: string, lines: ShipmentDefectRelocateLine[]) {
  return request<{ message: string }>(`/shipments/${id}/finish-defect-relocation`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
  })
}

// --- Упаковка (QC начальника смены): внесение годного/брака по строке ---
export type PackingPayload = { good_delta?: number; defect_delta?: number; packed_date: string }

// on_packing: внести годный и/или брак одной записью (дельты неотрицательны).
// requestId — идемпотентность: ретрай оборванного «Записать» не задвоит дельту.
export function recordPacking(docId: string, lineId: string, payload: PackingPayload, requestId?: string) {
  return request<{ message: string; packed_good: number; packed_defect: number }>(
    `/shipments/${docId}/lines/${lineId}/pack`,
    { method: 'POST', body: JSON.stringify(payload), headers: requestIdHeaders(requestId) },
  )
}

export type ShipmentPackingEntry = {
  id: string
  packed_date: string | null
  good: number
  defect: number
  created_at: string
  created_by_email: string | null
  repack_kind?: ShipmentRepackKind | null
  reversed: boolean
}

export type ShipmentPackingResponse = {
  plan: number
  available_for_pack: number
  packed_good: number
  packed_defect: number
  entries: ShipmentPackingEntry[]
}

export function getLinePacking(docId: string, lineId: string, signal?: AbortSignal) {
  return request<ShipmentPackingResponse>(`/shipments/${docId}/lines/${lineId}/packing`, { signal })
}

// Отмена ошибочной записи компенсирующим движением (внести верную можно заново).
export function reversePackingEntry(docId: string, lineId: string, entryId: string, requestId?: string) {
  return request<{ message: string; packed_good: number; packed_defect: number }>(
    `/shipments/${docId}/lines/${lineId}/packing/${entryId}/reverse`,
    { method: 'POST', headers: requestIdHeaders(requestId) },
  )
}

// --- Производительность упаковки (сводка «за смену») ---
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

// Нетто упаковано по дням (клиент × SKU). Деньги (earn_kop) бэкенд отдаёт
// только ролям с can_view_costs — для склада всегда нули, в UI их не показываем.
export function getPackingProductivity(params: PackingProductivityParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to)   sp.set('date_to', params.date_to)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search)    sp.set('search', params.search)
  const q = sp.toString()
  return request<PackingProductivityResponse>(`/shipments/packing/productivity${q ? `?${q}` : ''}`, { signal })
}

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

// --- Labels ---
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  draft: 'Черновик',
  packing: 'В плане',
  on_packing: 'На упаковке',
  relocating: 'Перемещение',
  packed: 'Упакован',
  awaiting_trip: 'Ожидает рейс',
  partially_shipped: 'Частично отгружено',
  shipped: 'Завершён',
  completed_no_goods: 'Завершён',
  cancelled: 'Аннулирован',
}
