import { request, requestForm } from './http'
import type { BadgeTone } from '../ui/primitives/Badge'

// --- Types ---

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'closed' | 'cancelled'

export type InvoiceOpType =
  | 'doc_create'
  | 'doc_update'
  | 'issue'
  | 'shipment_link'
  | 'shipment_unlink'
  | 'receipt_link'
  | 'receipt_unlink'
  | 'payment'
  | 'due_date_change'
  | 'amount_change'
  | 'close'
  | 'cancel'

export type InvoiceShipment = {
  shipment_doc_id: string
  doc_number: string
  cargo_type: string
  status: string
  status_label: string
  ship_date: string | null
  destination: string | null
  sku_count: number
  total_qty: number
  logistics_cost_kop: number
}

export type InvoiceReceipt = {
  receipt_doc_id: string
  doc_number: string
  status: string
  status_label: string
  arrival_date: string | null
  supplier_name: string | null
  sku_count: number
  total_qty: number
  logistics_cost_kop: number
}

export type InvoicePayment = {
  id: string
  amount: number
  paid_on: string | null
  comment: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
}

export type InvoiceFile = {
  id: string
  filename: string
  url: string
  mime_type: string | null
  created_at: string
}

export type InvoiceOp = {
  id: string
  op_type: InvoiceOpType
  comment: string | null
  created_at: string
  created_by: string | null
  created_by_email: string | null
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
  created_by: string | null
  updated_at: string | null
  dispatch_logistics_kop: number
  receipt_logistics_kop: number
  shipments: InvoiceShipment[]
  receipts: InvoiceReceipt[]
  payments: InvoicePayment[]
  files: InvoiceFile[]
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
  created_at: string
}

export type InvoiceListResponse = {
  items: InvoiceListItem[]
  total: number
  page: number
  limit: number
}

export type ProductPreview = { name: string; qty: number }

export type UninvoicedShipment = {
  id: string
  doc_number: string
  cargo_type: string
  client_id: string | null
  client_name: string | null
  destination: string | null
  ship_date: string | null
  sku_count: number
  total_qty: number
  products_preview: ProductPreview[]
  created_at: string
}

export type ShipmentContentsProduct = { product_id: string; name: string; sku: string | null; qty: number }
export type ShipmentContents = {
  products: ShipmentContentsProduct[]
  total_qty: number
  sku_count: number
  suggested_amount_kop: number
  logistics_amount_kop: number
  pallets_amount_kop: number
  has_missing_price: boolean
  has_missing_pallet_price: boolean
}

export type ReceiptContents = {
  products: ShipmentContentsProduct[]
  total_qty: number
  sku_count: number
  logistics_amount_kop: number
}

export type UninvoicedShipmentsResponse = {
  items: UninvoicedShipment[]
  total: number
  page: number
  limit: number
}

export type UninvoicedReceipt = {
  id: string
  doc_number: string
  client_id: string | null
  client_name: string | null
  supplier_name: string | null
  arrival_date: string | null
  logistics_cost_kop: number
  sku_count: number
  total_qty: number
  products_preview: ProductPreview[]
  created_at: string
}

export type UninvoicedReceiptsResponse = {
  items: UninvoicedReceipt[]
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

export type InvoiceCreatePayload = {
  client_id: string
  client_name?: string | null
  due_date?: string | null
  total_amount?: number
  comment?: string | null
  shipment_ids?: string[]
}

export type InvoiceUpdatePayload = {
  client_id?: string
  client_name?: string | null
  due_date?: string | null
  total_amount?: number
  comment?: string | null
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
  date_from?: string
  date_to?: string
}

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

export function getUninvoicedShipments(params: UninvoicedParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<UninvoicedShipmentsResponse>(`/invoices/uninvoiced-shipments${q ? `?${q}` : ''}`, { signal })
}

export function getInvoiceAlerts(signal?: AbortSignal) {
  return request<InvoiceAlerts>('/invoices/alerts', { signal })
}

export function getShipmentContents(shipmentIds: string[], signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('shipment_ids', shipmentIds.join(','))
  return request<ShipmentContents>(`/invoices/shipment-contents?${sp.toString()}`, { signal })
}

export function getUninvoicedReceipts(params: UninvoicedParams = {}, signal?: AbortSignal) {
  const sp = new URLSearchParams()
  if (params.page) sp.set('page', String(params.page))
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.client_id) sp.set('client_id', params.client_id)
  if (params.search) sp.set('search', params.search)
  if (params.date_from) sp.set('date_from', params.date_from)
  if (params.date_to) sp.set('date_to', params.date_to)
  const q = sp.toString()
  return request<UninvoicedReceiptsResponse>(`/invoices/uninvoiced-receipts${q ? `?${q}` : ''}`, { signal })
}

export function getReceiptContents(receiptIds: string[], signal?: AbortSignal) {
  const sp = new URLSearchParams()
  sp.set('receipt_ids', receiptIds.join(','))
  return request<ReceiptContents>(`/invoices/receipt-contents?${sp.toString()}`, { signal })
}

export function getInvoice(invoiceId: string, signal?: AbortSignal) {
  return request<InvoiceDetail>(`/invoices/${invoiceId}`, { signal })
}

export function createInvoice(payload: InvoiceCreatePayload) {
  return request<{ message: string }>('/invoices', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateInvoice(invoiceId: string, payload: InvoiceUpdatePayload) {
  return request<{ message: string }>(`/invoices/${invoiceId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function issueInvoice(invoiceId: string) {
  return request<{ message: string }>(`/invoices/${invoiceId}/issue`, { method: 'POST' })
}

export function attachInvoiceShipments(invoiceId: string, shipmentIds: string[]) {
  return request<{ message: string }>(`/invoices/${invoiceId}/shipments`, {
    method: 'POST',
    body: JSON.stringify({ shipment_ids: shipmentIds }),
  })
}

export function detachInvoiceShipment(invoiceId: string, shipmentDocId: string) {
  return request<{ message: string }>(`/invoices/${invoiceId}/shipments/${shipmentDocId}`, {
    method: 'DELETE',
  })
}

export function attachInvoiceReceipts(invoiceId: string, receiptIds: string[]) {
  return request<{ message: string }>(`/invoices/${invoiceId}/receipts`, {
    method: 'POST',
    body: JSON.stringify({ receipt_ids: receiptIds }),
  })
}

export function detachInvoiceReceipt(invoiceId: string, receiptDocId: string) {
  return request<{ message: string }>(`/invoices/${invoiceId}/receipts/${receiptDocId}`, {
    method: 'DELETE',
  })
}

export function addInvoicePayment(invoiceId: string, payload: { amount: number; paid_on?: string | null; comment?: string | null }) {
  return request<{ message: string }>(`/invoices/${invoiceId}/payments`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateInvoiceDueDate(invoiceId: string, dueDate: string, reason?: string | null) {
  return request<{ message: string }>(`/invoices/${invoiceId}/due-date`, {
    method: 'PATCH',
    body: JSON.stringify({ due_date: dueDate, reason: reason?.trim() || null }),
  })
}

export function updateInvoiceAmount(invoiceId: string, payload: { total_amount: number; reason: string }) {
  return request<{ message: string }>(`/invoices/${invoiceId}/amount`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function closeInvoice(invoiceId: string) {
  return request<{ message: string }>(`/invoices/${invoiceId}/close`, { method: 'POST' })
}

export function cancelInvoice(invoiceId: string) {
  return request<{ message: string }>(`/invoices/${invoiceId}/cancel`, { method: 'POST' })
}

export function uploadInvoiceFile(invoiceId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  return requestForm<{ message: string }>(`/invoices/${invoiceId}/files`, {
    method: 'POST',
    body: form,
  })
}

export function deleteInvoiceFile(invoiceId: string, fileId: string) {
  return request<{ message: string }>(`/invoices/${invoiceId}/files/${fileId}`, { method: 'DELETE' })
}

// --- Labels & helpers ---

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Черновик',
  issued: 'Выставлен',
  partially_paid: 'Частично оплачен',
  closed: 'Завершён',
  cancelled: 'Аннулирован',
}

export function invoiceStatusTone(status: InvoiceStatus): BadgeTone {
  const map: Record<InvoiceStatus, BadgeTone> = {
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
  payment: 'Оплата',
  due_date_change: 'Перенос срока',
  amount_change: 'Корректировка суммы',
  close: 'Завершение',
  cancel: 'Аннулирование',
}

export const INVOICE_ACTIVE_STATUSES: InvoiceStatus[] = ['issued', 'partially_paid']

export function isInvoiceActive(status: InvoiceStatus): boolean {
  return INVOICE_ACTIVE_STATUSES.includes(status)
}

export function isInvoiceDraft(status: InvoiceStatus): boolean {
  return status === 'draft'
}

// Перенос срока расчёта журналируется записью с комментарием «Срок: <старая> → <новая>»
// (ISO-даты или «—»). Структурированной истории в API нет — восстанавливаем её из
// журнала best-effort: при смене формата комментария история просто не покажется.
export type InvoiceDueChange = { from: string | null; to: string | null; at: string }

const DUE_CHANGE_RE = /Срок:\s*(.+?)\s*→\s*(.+?)\s*$/

export function parseDueHistory(ops: InvoiceOp[]): InvoiceDueChange[] {
  const norm = (s: string) => (s === '—' || s === '' ? null : s)
  return ops
    .filter((o) => o.op_type === 'due_date_change' && o.comment)
    .map((o): InvoiceDueChange | null => {
      const m = DUE_CHANGE_RE.exec(o.comment as string)
      return m ? { from: norm(m[1]), to: norm(m[2]), at: o.created_at } : null
    })
    .filter((x): x is InvoiceDueChange => x != null)
}
