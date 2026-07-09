import { request, requestForm, requestIdHeaders } from './http'

// --- Types --- (подмножество backend/modules/dispatch/schemas.py)
export type DispatchStatus =
  | 'draft'
  | 'awaiting_packing'
  | 'preparing'
  | 'awaiting_trip'
  | 'partially_shipped'
  | 'shipped'
  | 'cancelled'

export type DispatchCargoType = 'good' | 'defect'

export type DispatchListItem = {
  id: string
  doc_number: string
  cargo_type: DispatchCargoType
  client_name: string | null
  ship_date: string | null
  priority_rank: number | null
  status: DispatchStatus
  status_label: string
  sku_count: number
  total_qty: number
  total_shipped_qty: number
}

export type DispatchListResponse = { items: DispatchListItem[]; total: number; page: number; limit: number }

export type DispatchListParams = {
  page?: number
  limit?: number
  status?: string
  client_id?: string
  search?: string
  cargo_type?: DispatchCargoType
  available_for_trip_id?: string
}

// Отгрузки, которые можно увезти рейсом. Зеркало web DISPATCH_TRIP_SELECTABLE_STATUSES.
export const DISPATCH_TRIP_SELECTABLE_STATUSES = 'preparing,awaiting_trip,partially_shipped'

export type DispatchLineIn = {
  product_id: string
  product_name: string
  product_sku: string
  color_id?: string | null
  color_name?: string | null
  size_id?: string | null
  size_name?: string | null
  qty: number
  pallets_qty?: number | null
  boxes_qty?: number | null
  site_url?: string | null
  store_id?: string | null
  store_name?: string | null
}

export type DispatchDocCreate = {
  cargo_type?: DispatchCargoType
  client_id?: string | null
  client_name?: string | null
  logistics_cost?: number | null
  ship_date?: string | null
  comment?: string | null
  lines?: DispatchLineIn[]
}

export type DispatchLineFile = {
  id: string
  filename: string
  url: string
  mime_type: string | null
  created_at: string
}

export type DispatchLine = {
  id: string
  product_id: string
  product_name: string
  product_sku: string
  sku_pending: boolean
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  qty: number
  shipped_qty: number
  pallets_qty: number | null
  boxes_qty: number | null
  items_per_box: number | null
  boxes_per_pallet: number | null
  site_url: string | null
  store_id: string | null
  store_name: string | null
  remaining: number
  files: DispatchLineFile[]
}

export type DispatchOp = {
  id: string
  op_type: string
  comment: string | null
  created_at: string
  created_by_email: string | null
}

export type DispatchDetail = {
  id: string
  doc_number: string
  cargo_type: DispatchCargoType
  client_id: string | null
  client_name: string | null
  logistics_cost: number | null
  ship_date: string | null
  actual_ship_date: string | null
  comment: string | null
  status: DispatchStatus
  status_label: string
  priority_rank: number | null
  trips: { id: string; number: string }[]
  lines: DispatchLine[]
  ops: DispatchOp[]
  total_qty: number
}

export function getDispatch(id: string, signal?: AbortSignal): Promise<DispatchDetail> {
  return request<DispatchDetail>(`/dispatches/${id}`, { signal })
}

export function createDispatch(body: DispatchDocCreate): Promise<{ message: string }> {
  return request<{ message: string }>('/dispatches', { method: 'POST', body: JSON.stringify(body) })
}

export type DispatchDocUpdate = {
  cargo_type?: DispatchCargoType
  client_id?: string | null
  client_name?: string | null
  logistics_cost?: number | null
  ship_date?: string | null
  comment?: string | null
}

// Правка черновика: PATCH шлёт только заполненные поля (бэк exclude_unset).
export function updateDispatch(id: string, body: DispatchDocUpdate): Promise<{ message: string }> {
  return request<{ message: string }>(`/dispatches/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export type DispatchLineUpdate = {
  qty?: number
  pallets_qty?: number | null
  boxes_qty?: number | null
  site_url?: string | null
  store_id?: string | null
  store_name?: string | null
}

/** Рекомендованное число коробов: штук делится на «штук в коробе» вверх.
 *  null — кратность не задана в карточке товара (вводится вручную). */
export function recommendedBoxes(qty: number, itemsPerBox: number | null | undefined): number | null {
  if (!itemsPerBox || itemsPerBox <= 0) return null
  return Math.max(1, Math.ceil(qty / itemsPerBox))
}

/** Рекомендованное число палет: коробов делится на «коробов на палете» вверх.
 *  Палета меряется в коробах. null — кратность не задана либо коробов нет. */
export function recommendedPallets(boxes: number | null | undefined, boxesPerPallet: number | null | undefined): number | null {
  if (!boxesPerPallet || boxesPerPallet <= 0) return null
  if (!boxes || boxes <= 0) return null
  return Math.max(1, Math.ceil(boxes / boxesPerPallet))
}

export function addDispatchLine(docId: string, body: DispatchLineIn): Promise<{ message: string }> {
  return request<{ message: string }>(`/dispatches/${docId}/lines`, { method: 'POST', body: JSON.stringify(body) })
}

export function updateDispatchLine(docId: string, lineId: string, body: DispatchLineUpdate): Promise<{ message: string }> {
  return request<{ message: string }>(`/dispatches/${docId}/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function deleteDispatchLine(docId: string, lineId: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/dispatches/${docId}/lines/${lineId}`, { method: 'DELETE' })
}

// Вложение по строке отгрузки (zip/pdf/jpeg). Content-Type multipart ставит браузер.
export function uploadDispatchLineFile(docId: string, lineId: string, file: File): Promise<{ message: string }> {
  const form = new FormData()
  form.append('file', file)
  return requestForm<{ message: string }>(`/dispatches/${docId}/lines/${lineId}/files`, {
    method: 'POST',
    body: form,
  })
}

export function advanceDispatch(id: string): Promise<{ message: string }> {
  return request<{ message: string }>(`/dispatches/${id}/advance`, { method: 'POST' })
}

export function updateDispatchPriority(id: string, priorityRank: number | null) {
  return request<{ message: string }>(`/dispatches/${id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify({ priority_rank: priorityRank }),
  })
}

// Аннулировать можно, пока ничего не уехало (draft/preparing/awaiting_trip); из
// «Ожидает рейс» бэк автоворачивает подготовленный товар на исходные места.
export function cancelDispatch(id: string) {
  return request<{ message: string }>(`/dispatches/${id}/cancel`, { method: 'POST' })
}

// Приоритет — уровень срочности: 1 «Срочно», 2 «Повышенный», null «Обычный».
export const DISPATCH_PRIORITY_URGENT = 1
export const DISPATCH_PRIORITY_HIGH   = 2

export const DISPATCH_PRIORITY_LABELS: Record<number, string> = {
  [DISPATCH_PRIORITY_URGENT]: 'Срочно',
  [DISPATCH_PRIORITY_HIGH]:   'Повышенный',
}

export function dispatchPriorityLabel(rank: number | null): string {
  return (rank != null && DISPATCH_PRIORITY_LABELS[rank]) || 'Обычный'
}

export function dispatchPriorityTone(rank: number | null): 'danger' | 'warning' | '' {
  if (rank === DISPATCH_PRIORITY_URGENT) return 'danger'
  if (rank === DISPATCH_PRIORITY_HIGH) return 'warning'
  return ''
}

export type DispatchPrepareSource = { zone_id: string; zone_name: string | null; qty: number }
export type DispatchPrepareLine = { line_id: string; sources: DispatchPrepareSource[] }

// Подготовка отгрузки кладовщиком: preparing → awaiting_trip. Товар списывается с
// выбранных ячеек-источников и переезжает в зону отгрузки (ready).
export function finishDispatchPreparation(id: string, lines: DispatchPrepareLine[], requestId: string) {
  return request<{ message: string }>(`/dispatches/${id}/finish-preparation`, {
    method: 'POST',
    body: JSON.stringify({ lines }),
    headers: requestIdHeaders(requestId),
  })
}

// --- Проверка дубля (зеркало web DuplicateWarnModal) ---
export type DispatchDuplicateCheckLine = {
  product_id: string
  color_id?: string | null
  size_id?: string | null
  qty: number
}

export type DispatchDuplicateCheck = {
  cargo_type: DispatchCargoType
  client_id: string | null
  ship_date: string | null
  lines: DispatchDuplicateCheckLine[]
}

export type DuplicateMatchLine = {
  product_sku: string | null
  product_name: string | null
  color_name: string | null
  size_name: string | null
  qty: number
}

export type DuplicateMatch = {
  id: string
  doc_number: string
  status: string
  status_label: string
  created_at: string
  created_by_name: string | null
  lines: DuplicateMatchLine[]
}

/** Ищет уже созданные сегодня для клиента отгрузки с тем же составом. Проверка не
 *  критична — при ошибке создание не блокируем (см. вызов в форме). */
export function checkDispatchDuplicate(body: DispatchDuplicateCheck): Promise<{ matches: DuplicateMatch[] }> {
  return request<{ matches: DuplicateMatch[] }>('/dispatches/check-duplicate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/** Зарезервированный к отгрузке остаток по варианту (уже обещан незакрытым отгрузкам). */
export type DispatchReservation = {
  product_id: string
  color_id: string | null
  size_id: string | null
  reserved: number
}

/** Резервы по вариантам для клиента/типа груза — витрина показывает свободный, а не
 *  валовой остаток (тот же резерв вычитает серверный гейт «В ожидание рейса»). */
export function getDispatchReservations(
  params: { client_id?: string; cargo_type?: DispatchCargoType } = {},
  signal?: AbortSignal,
): Promise<{ items: DispatchReservation[] }> {
  const sp = new URLSearchParams()
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  const q = sp.toString()
  return request<{ items: DispatchReservation[] }>(`/dispatches/reservations${q ? `?${q}` : ''}`, { signal })
}

// --- API functions ---
export function getDispatches(params: DispatchListParams = {}, signal?: AbortSignal): Promise<DispatchListResponse> {
  const sp = new URLSearchParams()
  if (params.page)       sp.set('page', String(params.page))
  if (params.limit)      sp.set('limit', String(params.limit))
  if (params.status)     sp.set('status', params.status)
  if (params.client_id)  sp.set('client_id', params.client_id)
  if (params.search)     sp.set('search', params.search)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  if (params.available_for_trip_id) sp.set('available_for_trip_id', params.available_for_trip_id)
  const q = sp.toString()
  return request<DispatchListResponse>(`/dispatches${q ? `?${q}` : ''}`, { signal })
}

// --- Labels ---
export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  draft: 'Создание',
  awaiting_packing: 'Ожидание упаковки',
  preparing: 'Подготовка отгрузки',
  awaiting_trip: 'Ожидает рейс',
  partially_shipped: 'Частично отгружено',
  shipped: 'Отгружено',
  cancelled: 'Аннулирована',
}

export function dispatchStatusTone(status: DispatchStatus): string {
  const map: Record<DispatchStatus, string> = {
    draft: '',
    awaiting_packing: 'info',
    preparing: 'info',
    awaiting_trip: 'warning',
    partially_shipped: 'warning',
    shipped: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}
