import { request } from './http'

// --- Types ---
/** Короб: тара задачи «Упаковка с ТСД». */
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
  product_id?: string
}

export type ContainerLabel = {
  id: string
  doc_number: string
  payload: string // содержимое QR: «wms:box:<id>»
  qr_svg: string
}

export type ContainerLookupResponse = { found: boolean; container: ContainerItem | null }

/** Позиция в пачке переноса: ШК со сканера либо явный вариант (в вебе сканера нет).
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

/** «Откуда» одной ходки: зона упаковки (упакованное у стола), место или размещённый короб.
 *
 * Относится ко всей пачке и имеет приоритет над from_zone_id строк. Названный
 * источник ещё и сверяется с учётом: короб, который числится в другом месте, — ошибка.
 */
export type ContainerPlaceSource =
  | { kind: 'collected' }
  | { kind: 'location'; id: string }
  | { kind: 'container'; id: string }

/** «Куда»: место хранения либо размещённый короб (только для товара). */
export type ContainerPlaceTarget = { kind: 'location' | 'container'; id: string }

export type ContainerPlacePayload = {
  /** Приёмник-место в старой форме запроса; target его заменяет. */
  zone_id?: string
  source?: ContainerPlaceSource
  target?: ContainerPlaceTarget
  box_ids?: string[]
  items?: ContainerPlaceItemScan[]
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
  /** Товар доложен в размещённый короб: место — то, где стоит короб. */
  target_container: ContainerItem | null
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

/** Упакованное без короба (габарит, брак): короба у него нет, только корзина packed. */
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
  if (params.product_id) sp.set('product_id', params.product_id)
  const q = sp.toString()
  return request<ContainerListResponse>(`/containers${q ? `?${q}` : ''}`, { signal })
}

export function getPendingPlacement(signal?: AbortSignal) {
  return request<ContainerPendingPlacement>('/containers/pending-placement', { signal })
}

export function getContainer(id: string, signal?: AbortSignal) {
  return request<ContainerDetailResponse>(`/containers/${id}`, { signal })
}

/** Завести пачку пустых коробов под печать этикеток. */
export function createContainers(count: number) {
  return request<{ items: ContainerItem[] }>('/containers', {
    method: 'POST',
    body: JSON.stringify({ count }),
  })
}

/** Результат удаления пачки: что удалось убрать, а что уже в работе. */
export type ContainerDeleteResult = {
  deleted: number
  skipped: number
  skipped_numbers: string[]
}

/** Удалить ошибочно заведённые короба — только свободные, не пущенные в дело. */
export function deleteContainers(ids: string[]) {
  return request<ContainerDeleteResult>('/containers/delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

export function getContainerLabels(ids: string[], signal?: AbortSignal) {
  const sp = new URLSearchParams({ ids: ids.join(',') })
  return request<{ items: ContainerLabel[] }>(`/containers/labels?${sp.toString()}`, { signal })
}

/** Раскладка позиции по коробам: чем строка остатка отличается от россыпи. */
export type ContainerHoldingRow = {
  zone_id: string
  zone_name: string | null
  product_id: string
  color_id: string | null
  size_id: string | null
  client_id: string | null
  quality: 'good' | 'defect'
  /** Корзина остатка: packed — короб у стола, ждёт развозки; ready — развезён в зону отгрузки; storage — на хранении. */
  op_status: 'storage' | 'packed' | 'ready'
  container_id: string
  doc_number: string
  status: ContainerStatus
  qty: number
}

export function getContainerHoldings(zoneIds: string[], signal?: AbortSignal) {
  const sp = new URLSearchParams({ zone_ids: zoneIds.join(',') })
  return request<{ items: ContainerHoldingRow[] }>(`/containers/holdings?${sp.toString()}`, { signal })
}

/** «Где лежит» для одного варианта: короба по всем местам, а не по странице остатков. */
export function getVariantHoldings(
  params: { product_id: string; color_id?: string | null; size_id?: string | null },
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams({ product_id: params.product_id })
  if (params.color_id) sp.set('color_id', params.color_id)
  if (params.size_id) sp.set('size_id', params.size_id)
  return request<{ items: ContainerHoldingRow[] }>(`/containers/holdings?${sp.toString()}`, { signal })
}

export function getContainerByCode(code: string, signal?: AbortSignal) {
  return request<ContainerLookupResponse>(`/containers/by-code/${encodeURIComponent(code)}`, { signal })
}

/** Перенос размещённого короба в другое место. */
export function moveContainer(id: string, zoneId: string) {
  return request<ContainerItem>(`/containers/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ zone_id: zoneId }),
  })
}

/** Перемещение пачки «откуда → что → куда» — одна ходка кладовщика, один запрос.
 *
 * Закрытые короба встают на место, размещённые переезжают, товар едет со стола,
 * с полки или из короба — на полку или в размещённый короб.
 */
export function placeContainers(payload: ContainerPlacePayload) {
  return request<ContainerPlaceResult>('/containers/place', {
    method: 'POST',
    body: JSON.stringify({ ...payload, box_ids: payload.box_ids ?? [], items: payload.items ?? [] }),
  })
}

/** Изъятие позиции из размещённого короба: товар остаётся в месте россыпью. */
export function removeContainerItem(
  id: string,
  payload: { barcode?: string; product_id?: string; color_id?: string | null; size_id?: string | null; qty?: number },
) {
  return request<ContainerItem>(`/containers/${id}/items/remove`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// --- Labels & helpers ---
export const CONTAINER_STATUS_LABELS: Record<ContainerStatus, string> = {
  new: 'Свободен',
  open: 'Набирается',
  closed: 'Закрыт',
  placed: 'Размещён',
}

export function containerStatusTone(status: ContainerStatus): string {
  if (status === 'placed') return 'success'
  if (status === 'closed') return 'info'
  if (status === 'open') return 'warning'
  return ''
}
