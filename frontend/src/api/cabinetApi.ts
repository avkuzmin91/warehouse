import { request } from './http'
import type { ProductItem, ProductListResponse, ProductVariantItem } from './domainTypes'
import type { BalanceListResponse, BalanceSummary } from './balancesApi'

// --- Types ---

export type CabinetReceiptStatus = 'planned' | 'on_intake' | 'partially_received' | 'on_review' | 'done' | 'cancelled'
export type CabinetShipmentStatus = 'packing' | 'on_packing' | 'relocating' | 'awaiting_trip' | 'partially_shipped' | 'shipped' | 'cancelled'
export type CabinetCargoType = 'good' | 'defect'

export type CabinetOpItem = {
  op_type: string
  qty?: number | null
  comment: string | null
  created_at: string
}

export type CabinetReceiptListItem = {
  id: string
  doc_number: string
  arrival_date: string | null
  actual_arrival_date: string | null
  status: CabinetReceiptStatus
  sku_count: number
  total_planned: number
  total_accepted_qty: number
  created_at: string
}

export type CabinetReceiptListResponse = {
  items: CabinetReceiptListItem[]
  total: number
  page: number
  limit: number
}

export type CabinetReceiptLineItem = {
  doc_id: string
  doc_number: string
  status: CabinetReceiptStatus
  arrival_date: string | null
  actual_arrival_date: string | null
  product_name: string
  product_sku: string
  color_name: string | null
  size_name: string | null
  planned_qty: number
  accepted_qty: number | null
}

export type CabinetReceiptLinesResponse = {
  items: CabinetReceiptLineItem[]
  total: number
  page: number
  limit: number
}

export type CabinetReceiptDetail = {
  doc: {
    id: string
    doc_number: string
    arrival_date: string | null
    actual_arrival_date: string | null
    ttn: string | null
    status: CabinetReceiptStatus
    created_at: string
  }
  lines: {
    product_name: string
    product_sku: string
    color_name: string | null
    size_name: string | null
    planned_qty: number
    accepted_qty: number | null
  }[]
  ops: CabinetOpItem[]
  totals: { total_planned: number; total_accepted: number }
}

export type CabinetShipmentListItem = {
  id: string
  doc_number: string
  cargo_type: CabinetCargoType
  store_names: string[]
  ship_date: string | null
  actual_ship_date: string | null
  status: CabinetShipmentStatus
  sku_count: number
  total_qty: number
  total_packed_qty: number
  total_shipped_qty: number
  created_at: string
}

export type CabinetShipmentListResponse = {
  items: CabinetShipmentListItem[]
  total: number
  page: number
  limit: number
}

export type CabinetShipmentLineItem = {
  doc_id: string
  doc_number: string
  cargo_type: CabinetCargoType
  status: CabinetShipmentStatus
  ship_date: string | null
  product_name: string
  product_sku: string
  color_name: string | null
  size_name: string | null
  qty: number
  shipped_qty: number
  store_name: string | null
}

export type CabinetShipmentLinesResponse = {
  items: CabinetShipmentLineItem[]
  total: number
  page: number
  limit: number
}

export type CabinetShipmentDetail = {
  doc: {
    id: string
    doc_number: string
    cargo_type: CabinetCargoType
    ship_date: string | null
    actual_ship_date: string | null
    status: CabinetShipmentStatus
    created_at: string
  }
  lines: {
    id: string
    product_name: string
    product_sku: string
    color_name: string | null
    size_name: string | null
    qty: number
    shipped_qty: number
    packed_good: number
    packed_defect: number
    store_name: string | null
    files: { filename: string; url: string }[]
  }[]
  ops: CabinetOpItem[]
}

export type CabinetSummary = {
  totals: {
    storage_good: number
    packing_good: number
    ready_good: number
    total_good: number
    defect_total: number
  }
  active_receipts: CabinetReceiptListItem[]
  active_shipments: CabinetShipmentListItem[]
  events: {
    doc_kind: 'receipt' | 'shipment'
    doc_id: string
    doc_number: string
    op_type: string
    qty: number | null
    comment: string | null
    created_at: string
  }[]
}

export type CabinetPackingReport = {
  days: {
    packed_date: string
    good: number
    defect: number
    total: number
    sku_count: number
    doc_count: number
    rows: {
      product_sku: string | null
      product_name: string | null
      good: number
      defect: number
      total: number
    }[]
  }[]
  total_good: number
  total_defect: number
  total: number
}

export type CabinetProfile = {
  client: { id: string; name: string }
  stores: { id: string; name: string; is_active: boolean }[]
}

export type CabinetBalanceListParams = {
  page?: number
  limit?: number
  search?: string
  only_positive?: boolean
  has_defect?: boolean
}

export type CabinetWriteOffItem = {
  id:           string
  created_at:   string
  product_name: string | null
  product_sku:  string | null
  color_name:   string | null
  size_name:    string | null
  quality:      string
  qty:          number
  reason:       string | null
  comment:      string | null
}

export type CabinetWriteOffsResponse = {
  items: CabinetWriteOffItem[]
  total: number
  page:  number
  limit: number
}

export type CabinetProductListParams = {
  page?: number
  limit?: number
  search?: string
  sort?: string
}

export type CabinetDocListParams = {
  page?: number
  limit?: number
  status?: string
  search?: string
  date_from?: string
  date_to?: string
}

export type CabinetShipmentListParams = CabinetDocListParams & {
  cargo_type?: CabinetCargoType
}

// --- API functions ---

function docListQuery(params: CabinetDocListParams & { cargo_type?: string }): string {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.status) sp.set('status', params.status)
  if (params.cargo_type) sp.set('cargo_type', params.cargo_type)
  if (params.search) sp.set('search', params.search)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  const q = sp.toString()
  return q ? `?${q}` : ''
}

export function getCabinetSummary(signal?: AbortSignal) {
  return request<CabinetSummary>('/cabinet/summary', { signal })
}

export function getCabinetBalancesSummary(
  params: { search?: string; has_defect?: boolean } = {},
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  if (params.search) sp.set('search', params.search)
  if (params.has_defect) sp.set('has_defect', 'true')
  const q = sp.toString()
  return request<BalanceSummary>(`/cabinet/balances/summary${q ? `?${q}` : ''}`, { signal })
}

export function getCabinetBalances(params: CabinetBalanceListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.only_positive === false) sp.set('only_positive', 'false')
  if (params.has_defect) sp.set('has_defect', 'true')
  const q = sp.toString()
  return request<BalanceListResponse>(`/cabinet/balances${q ? `?${q}` : ''}`, { signal })
}

export function getCabinetWriteOffs(params: { page?: number; limit?: number } = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<CabinetWriteOffsResponse>(`/cabinet/write-offs${q ? `?${q}` : ''}`, { signal })
}

export function getCabinetReceipts(params: CabinetDocListParams = {}, signal?: AbortSignal) {
  return request<CabinetReceiptListResponse>(`/cabinet/receipts${docListQuery(params)}`, { signal })
}

export function getCabinetReceiptLines(params: CabinetDocListParams = {}, signal?: AbortSignal) {
  return request<CabinetReceiptLinesResponse>(`/cabinet/receipts/lines${docListQuery(params)}`, { signal })
}

export function getCabinetReceipt(docId: string, signal?: AbortSignal) {
  return request<CabinetReceiptDetail>(`/cabinet/receipts/${docId}`, { signal })
}

export function getCabinetShipments(params: CabinetShipmentListParams = {}, signal?: AbortSignal) {
  return request<CabinetShipmentListResponse>(`/cabinet/shipments${docListQuery(params)}`, { signal })
}

export function getCabinetShipmentLines(params: CabinetShipmentListParams = {}, signal?: AbortSignal) {
  return request<CabinetShipmentLinesResponse>(`/cabinet/shipments/lines${docListQuery(params)}`, { signal })
}

export function getCabinetShipment(docId: string, signal?: AbortSignal) {
  return request<CabinetShipmentDetail>(`/cabinet/shipments/${docId}`, { signal })
}

export function getCabinetPackingReport(
  params: { date_from?: string; date_to?: string; search?: string } = {},
  signal?: AbortSignal,
) {
  const sp = new URLSearchParams()
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<CabinetPackingReport>(`/cabinet/reports/packing${q ? `?${q}` : ''}`, { signal })
}

export function getCabinetProfile(signal?: AbortSignal) {
  return request<CabinetProfile>('/cabinet/profile', { signal })
}

export function getCabinetProducts(params: CabinetProductListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.search) sp.set('search', params.search)
  if (params.sort) sp.set('sort', params.sort)
  const q = sp.toString()
  return request<ProductListResponse>(`/cabinet/products${q ? `?${q}` : ''}`, { signal })
}

export function getCabinetProduct(productId: string, signal?: AbortSignal) {
  return request<ProductItem>(`/cabinet/products/${productId}`, { signal })
}

export function getCabinetProductVariants(productId: string, signal?: AbortSignal) {
  return request<ProductVariantItem[]>(`/cabinet/products/${productId}/variants`, { signal })
}

// --- Labels & helpers (клиентская лексика статусов) ---

export const CABINET_RECEIPT_STATUS_ORDER: CabinetReceiptStatus[] = [
  'planned', 'on_intake', 'partially_received', 'on_review', 'done', 'cancelled',
]

export const CABINET_RECEIPT_STATUS_LABELS: Record<CabinetReceiptStatus, string> = {
  planned: 'Ожидается',
  on_intake: 'Идёт приёмка',
  partially_received: 'Частично принято',
  on_review: 'Проверка',
  done: 'Принято',
  cancelled: 'Аннулировано',
}

export function cabinetReceiptStatusTone(status: CabinetReceiptStatus): string {
  const map: Record<CabinetReceiptStatus, string> = {
    planned: 'info',
    on_intake: 'warning',
    partially_received: 'warning',
    on_review: 'warning',
    done: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}

export const CABINET_SHIPMENT_STATUS_ORDER: CabinetShipmentStatus[] = [
  'packing', 'on_packing', 'relocating', 'awaiting_trip', 'partially_shipped', 'shipped', 'cancelled',
]

export const CABINET_SHIPMENT_STATUS_LABELS: Record<CabinetShipmentStatus, string> = {
  packing: 'Принят в работу',
  on_packing: 'Упаковка',
  relocating: 'Готовится к отправке',
  awaiting_trip: 'Готовится к отправке',
  partially_shipped: 'Частично отгружено',
  shipped: 'Отгружено',
  cancelled: 'Аннулировано',
}

export const CABINET_DEFECT_SHIPMENT_STATUS_LABELS: Record<CabinetShipmentStatus, string> = {
  packing: 'Принят в работу',
  on_packing: 'Упаковка',
  relocating: 'Подготовка возврата',
  awaiting_trip: 'Готов к возврату',
  partially_shipped: 'Частично возвращено',
  shipped: 'Возвращено',
  cancelled: 'Аннулировано',
}

export function cabinetShipmentStatusLabel(status: CabinetShipmentStatus, cargoType: CabinetCargoType): string {
  const table = cargoType === 'defect' ? CABINET_DEFECT_SHIPMENT_STATUS_LABELS : CABINET_SHIPMENT_STATUS_LABELS
  return table[status] ?? status
}

export function cabinetShipmentStatusTone(status: CabinetShipmentStatus): string {
  const map: Record<CabinetShipmentStatus, string> = {
    packing: '',
    on_packing: 'info',
    relocating: 'accent',
    awaiting_trip: 'accent',
    partially_shipped: 'accent',
    shipped: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}
