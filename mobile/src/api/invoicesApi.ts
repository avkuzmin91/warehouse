import { request } from './http'

// --- Types --- (подмножество frontend/src/api/invoicesApi.ts; суммы — копейки INTEGER)

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'closed' | 'cancelled'

export type InvoiceOpType =
  | 'doc_create'
  | 'doc_update'
  | 'issue'
  | 'shipment_link'
  | 'shipment_unlink'
  | 'receipt_link'
  | 'receipt_unlink'
  | 'extra_income_link'
  | 'extra_income_unlink'
  | 'payment'
  | 'due_date_change'
  | 'amount_change'
  | 'close'
  | 'cancel'

export type InvoicePayment = {
  id: string
  amount: number
  paid_on: string | null
  comment: string | null
  created_at: string
  created_by_email: string | null
}

export type InvoiceOp = {
  id: string
  op_type: InvoiceOpType
  comment: string | null
  created_at: string
  created_by_email: string | null
}

export type InvoiceShipment = {
  shipment_doc_id: string
  doc_number: string
  status_label: string
  ship_date: string | null
  total_qty: number
}

export type InvoiceReceipt = {
  receipt_doc_id: string
  doc_number: string
  status_label: string
  arrival_date: string | null
  total_qty: number
}

export type InvoiceExtraIncome = {
  entry_id: string
  entry_date: string
  category_name: string | null
  qty: number | null
  amount_kop: number
  comment: string | null
}

export type InvoiceDetail = {
  id: string
  doc_number: string
  client_id: string | null
  client_name: string | null
  status: InvoiceStatus
  status_label: string
  total_amount: number
  paid_amount: number
  due_date: string | null
  overdue: boolean
  due_reached: boolean
  comment: string | null
  created_at: string
  shipments: InvoiceShipment[]
  receipts: InvoiceReceipt[]
  extra_income: InvoiceExtraIncome[]
  payments: InvoicePayment[]
  ops: InvoiceOp[]
}

export type InvoiceListItem = {
  id: string
  doc_number: string
  client_id: string | null
  client_name: string | null
  status: InvoiceStatus
  status_label: string
  total_amount: number
  paid_amount: number
  due_date: string | null
  overdue: boolean
  shipment_count: number
  receipt_count: number
  extra_count: number
  created_at: string
}

export type InvoiceListResponse = {
  items: InvoiceListItem[]
  total: number
  page: number
  limit: number
}

export type InvoiceAlerts = {
  due_count: number
  overdue_count: number
  active_count: number
  active_outstanding: number
}

export type InvoiceListParams = {
  page?: number
  limit?: number
  status?: string
  client_id?: string
  search?: string
  overdue?: boolean
}

export type UninvoicedParams = {
  page?: number
  limit?: number
  client_id?: string
  search?: string
}

export type ProductPreview = { name: string; qty: number }

export type UninvoicedShipment = {
  id: string
  doc_number: string
  client_name: string | null
  ship_date: string | null
  sku_count: number
  total_qty: number
  products_preview: ProductPreview[]
}

export type UninvoicedReceipt = {
  id: string
  doc_number: string
  client_name: string | null
  arrival_date: string | null
  logistics_cost_kop: number
  sku_count: number
  total_qty: number
  products_preview: ProductPreview[]
}

export type UninvoicedExtraIncome = {
  id: string
  entry_date: string
  client_name: string | null
  category_name: string | null
  qty: number | null
  amount_kop: number
  comment: string | null
}

type Paged<T> = { items: T[]; total: number; page: number; limit: number }

// --- API functions ---

export function getInvoices(params: InvoiceListParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.status) sp.set('status', params.status)
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.overdue) sp.set('overdue', 'true')
  const q = sp.toString()
  return request<InvoiceListResponse>(`/invoices${q ? `?${q}` : ''}`, { signal })
}

export function getInvoice(invoiceId: string, signal?: AbortSignal) {
  return request<InvoiceDetail>(`/invoices/${invoiceId}`, { signal })
}

export function getInvoiceAlerts(signal?: AbortSignal) {
  return request<InvoiceAlerts>('/invoices/alerts', { signal })
}

// Платёж по счёту: сумма в копейках; полная оплата закрывает счёт на бэке.
export function addInvoicePayment(invoiceId: string, payload: { amount: number; paid_on?: string | null; comment?: string | null }) {
  return request<{ message: string }>(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getUninvoicedShipments(params: UninvoicedParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<Paged<UninvoicedShipment>>(`/invoices/uninvoiced-shipments${q ? `?${q}` : ''}`, { signal })
}

export function getUninvoicedReceipts(params: UninvoicedParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  const q = sp.toString()
  return request<Paged<UninvoicedReceipt>>(`/invoices/uninvoiced-receipts${q ? `?${q}` : ''}`, { signal })
}

export function getUninvoicedExtraIncome(params: UninvoicedParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  const q = sp.toString()
  return request<Paged<UninvoicedExtraIncome>>(`/invoices/uninvoiced-extra-income${q ? `?${q}` : ''}`, { signal })
}

// --- Labels & helpers ---

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Черновик',
  issued: 'Выставлен',
  partially_paid: 'Частично оплачен',
  closed: 'Завершён',
  cancelled: 'Аннулирован',
}

export function invoiceStatusTone(status: InvoiceStatus): string {
  const map: Record<InvoiceStatus, string> = {
    draft: '',
    issued: 'info',
    partially_paid: 'warning',
    closed: 'success',
    cancelled: 'danger',
  }
  return map[status] ?? ''
}

export const INVOICE_OP_LABELS: Record<InvoiceOpType, string> = {
  doc_create: 'Черновик создан',
  doc_update: 'Изменение',
  issue: 'Счёт выставлен',
  shipment_link: 'Привязана отгрузка',
  shipment_unlink: 'Отвязана отгрузка',
  receipt_link: 'Привязано поступление',
  receipt_unlink: 'Отвязано поступление',
  extra_income_link: 'Привязана доп. работа',
  extra_income_unlink: 'Отвязана доп. работа',
  payment: 'Оплата',
  due_date_change: 'Перенос срока',
  amount_change: 'Корректировка суммы',
  close: 'Завершение',
  cancel: 'Аннулирование',
}
