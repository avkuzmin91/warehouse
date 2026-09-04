import { request, requestIdHeaders } from './http'

// --- Types ---
/** Короб: тара задачи «Размещение по ячейкам». */
export type ContainerStatus = 'new' | 'open' | 'closed' | 'placed'

export type ContainerItem = {
  id: string
  doc_number: string // человекочитаемый номер «BOX-000123», он же на этикетке
  status: ContainerStatus
  doc_id: string | null
  doc_number_task: string | null
  client_id: string | null
  client_name: string | null
  store_id: string | null
  store_name: string | null
  zone_id: string | null
  zone_name: string | null
  items_qty: number
  created_at: string
  closed_at: string | null
  placed_at: string | null
}

export type ContainerContentLine = {
  product_id: string
  product_name: string | null
  product_sku: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  quality: 'good' | 'defect'
  qty: number
}

export type ContainerOp = {
  id: string
  op_type: string
  product_name: string | null
  product_sku: string | null
  color_name: string | null
  size_name: string | null
  qty: number | null
  zone_name: string | null
  comment: string | null
  created_at: string
  created_by: string | null
  created_by_name: string | null
}

export type ContainerDetailResponse = {
  doc: ContainerItem
  contents: ContainerContentLine[]
  ops: ContainerOp[]
}

export type ContainerListResponse = {
  items: ContainerItem[]
  total: number
  page: number
  limit: number
}

export type ContainerListParams = {
  page?: number
  limit?: number
  status?: string
  client_id?: string
  doc_id?: string
  zone_id?: string
  search?: string
}

export type ContainerLookupResponse = { found: boolean; container: ContainerItem | null }

/** Позиция в пачке переноса: ШК со сканера либо явный вариант.
 *
 * from_zone_id — «взял отсюда»; без него товар ищется сам: сначала среди ждущего
 * размещения, затем на хранении. Качество не указывают, пока оно однозначно.
 */
export type ContainerPlaceItemScan = {
  barcode?: string
  product_id?: string
  color_id?: string | null
  size_id?: string | null
  qty?: number
  quality?: 'good' | 'defect'
  from_zone_id?: string | null
}

export type ContainerPlacedItem = {
  product_name: string | null
  product_sku: string | null
  color_name: string | null
  size_name: string | null
  quality: 'good' | 'defect'
  qty: number
  /** false — товар взят с полки (перенос), true — собранное, ждавшее размещения. */
  from_collected: boolean
}

export type ContainerPlaceResult = {
  zone_id: string
  zone_name: string
  boxes: ContainerItem[]
  items: ContainerPlacedItem[]
  placed_qty: number
}

/** Закрытый короб у стола: ждёт, когда его увезут в место хранения. */
export type ContainerPendingBox = {
  id: string
  doc_number: string
  client_name: string | null
  items_qty: number
  closed_at: string | null
}

/** Собранное мимо короба (габарит, брак): короба у него нет, только корзина boxed. */
export type ContainerPendingAsideItem = {
  product_id: string
  product_name: string | null
  product_sku: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  client_name: string | null
  quality: 'good' | 'defect'
  qty: number
}

/** Очередь развозки: что закрыто у стола и ещё не уехало в место хранения. */
export type ContainerPendingPlacement = {
  boxes: ContainerPendingBox[]
  boxes_qty: number
  aside: ContainerPendingAsideItem[]
  aside_qty: number
  since: string | null
}

// --- API functions ---
export function getContainers(params: ContainerListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.status) sp.set('status', params.status)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.doc_id) sp.set('doc_id', params.doc_id)
  if (params.zone_id) sp.set('zone_id', params.zone_id)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<ContainerListResponse>(`/containers${q ? `?${q}` : ''}`, { signal })
}

export function getPendingPlacement(signal?: AbortSignal) {
  return request<ContainerPendingPlacement>('/containers/pending-placement', { signal })
}

export function getContainer(id: string, signal?: AbortSignal) {
  return request<ContainerDetailResponse>(`/containers/${id}`, { signal })
}

export function getContainerByCode(code: string, signal?: AbortSignal) {
  return request<ContainerLookupResponse>(`/containers/by-code/${encodeURIComponent(code)}`, { signal })
}

/** Размещение пачки: сканы коробов и товара, затем скан места хранения.
 *
 * Одна ходка кладовщика = один запрос. Закрытые короба встают на место, уже
 * размещённые переезжают, россыпь мимо коробов уезжает туда же.
 */
export function placeContainers(
  payload: { zone_id: string; box_ids?: string[]; items?: ContainerPlaceItemScan[] },
  requestId: string,
) {
  return request<ContainerPlaceResult>('/containers/place', {
    method: 'POST',
    body: JSON.stringify({
      zone_id: payload.zone_id,
      box_ids: payload.box_ids ?? [],
      items: payload.items ?? [],
    }),
    headers: requestIdHeaders(requestId),
  })
}

/** Перенос размещённого короба в другое место. */
export function moveContainer(id: string, zoneId: string, requestId: string) {
  return request<ContainerItem>(`/containers/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ zone_id: zoneId }),
    headers: requestIdHeaders(requestId),
  })
}

/** Изъятие позиции из размещённого короба: товар остаётся в месте россыпью. */
export function removeContainerItem(
  id: string,
  payload: { barcode?: string; product_id?: string; color_id?: string | null; size_id?: string | null; qty?: number },
  requestId: string,
) {
  return request<ContainerItem>(`/containers/${id}/items/remove`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: requestIdHeaders(requestId),
  })
}

// --- Labels & helpers ---
export const CONTAINER_STATUS_LABELS: Record<ContainerStatus, string> = {
  new: 'Свободен',
  open: 'Набирается',
  closed: 'Закрыт',
  placed: 'Размещён',
}

/** QR короба: «wms:box:<id>». Номер BOX-000123 печатается рядом и тоже принимается. */
export const CONTAINER_QR_PREFIX = 'wms:box:'

export function isContainerCode(raw: string): boolean {
  const s = (raw || '').trim()
  return s.startsWith(CONTAINER_QR_PREFIX) || /^BOX-\d+$/i.test(s)
}
