import { request } from './http'

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

export type ContainerLabel = {
  id: string
  doc_number: string
  payload: string // содержимое QR: «wms:box:<id>»
  qr_svg: string
}

export type ContainerLookupResponse = { found: boolean; container: ContainerItem | null }

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

export function getContainerLabels(ids: string[], signal?: AbortSignal) {
  const sp = new URLSearchParams({ ids: ids.join(',') })
  return request<{ items: ContainerLabel[] }>(`/containers/labels?${sp.toString()}`, { signal })
}

export function getContainerByCode(code: string, signal?: AbortSignal) {
  return request<ContainerLookupResponse>(`/containers/by-code/${encodeURIComponent(code)}`, { signal })
}

/** Перенос размещённого короба в другую ячейку. */
export function moveContainer(id: string, zoneId: string) {
  return request<ContainerItem>(`/containers/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ zone_id: zoneId }),
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
