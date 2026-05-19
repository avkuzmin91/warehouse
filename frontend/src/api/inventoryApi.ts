import { request } from './http'
import type {
  DictionaryItem,
  InventoryBalanceListResponse,
  InventoryOpType,
  InventoryOperationListResponse,
  InventoryProductLookup,
  InventoryProductTypeLookup,
} from './domainTypes'

export type {
  DictionaryItem,
  InventoryBalanceItem,
  InventoryBalanceListResponse,
  InventoryOpType,
  InventoryOperationItem,
  InventoryOperationListResponse,
  InventoryProductLookup,
  InventoryProductTypeLookup,
} from './domainTypes'

export function getInventoryClients() {
  return request<DictionaryItem[]>('/inventory/lookups/clients')
}

export function getInventoryColors() {
  return request<DictionaryItem[]>('/inventory/lookups/colors')
}

export function getInventoryColorsForProductSku(sku: string) {
  const s = sku.trim()
  if (!s) return Promise.resolve([] as DictionaryItem[])
  return request<DictionaryItem[]>(
    `/inventory/lookups/colors-for-sku?sku=${encodeURIComponent(s)}`,
  )
}

export function getInventorySizesForProductSkuAndColor(sku: string, colorId: string) {
  const s = sku.trim()
  const c = colorId.trim()
  if (!s || !c) return Promise.resolve([] as DictionaryItem[])
  const sp = new URLSearchParams()
  sp.set('sku', s)
  sp.set('color_id', c)
  return request<DictionaryItem[]>(`/inventory/lookups/sizes-for-sku?${sp.toString()}`)
}

export function getInventorySizes() {
  return request<DictionaryItem[]>('/inventory/lookups/sizes')
}

export function getInventorySuppliers() {
  return request<DictionaryItem[]>('/inventory/lookups/suppliers')
}

export function getInventoryProductTypes() {
  return request<InventoryProductTypeLookup[]>('/inventory/lookups/product-types')
}

export function getInventoryProducts(clientId?: string | null) {
  const cid = clientId?.trim()
  const q = cid ? `?client_id=${encodeURIComponent(cid)}` : ''
  return request<InventoryProductLookup[]>(`/inventory/lookups/products${q}`)
}

export function getInventoryProductSkus() {
  return request<string[]>('/inventory/lookups/skus')
}

export function getInventorySingleBalance(params: {
  product_id: string
  color_id?: string | null
  size_id?: string | null
}) {
  const sp = new URLSearchParams()
  sp.set('product_id', params.product_id)
  if (params.color_id) sp.set('color_id', params.color_id)
  if (params.size_id) sp.set('size_id', params.size_id)
  return request<{ quantity: number }>(`/inventory/balance/single?${sp.toString()}`)
}

export type ProductVariantFindItem = {
  variant_id: string
  product_id: string
  product_name: string
  product_type_name?: string | null
  client_name?: string | null
  requires_size: boolean
  sku: string
  color_id: string
  size_id: string | null
  length: number
  width: number
  height: number
  first_image_url: string | null
}

export type ProductVariantFindResponse = {
  found: boolean
  variant: ProductVariantFindItem | null
  needs_size: boolean
}

export function findProductVariantForReceipt(params: {
  sku: string
  color_id: string
  size_id?: string | null
}) {
  const sp = new URLSearchParams()
  sp.set('sku', params.sku.trim())
  sp.set('color_id', params.color_id.trim())
  if (params.size_id?.trim()) sp.set('size_id', params.size_id.trim())
  return request<ProductVariantFindResponse>(`/product-variants/find?${sp.toString()}`)
}

export function createInventoryReceipt(payload: { variant_id: string; quantity: number }) {
  return request<{ message: string }>('/inventory/receipt', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function createReceipt(payload: {
  variant_id: string
  quantity: number
  comment?: string | null
  receipt_date?: string | null
  receipt_status?: 'pending' | 'accepted'
}) {
  return request<{ message: string }>('/receipts', {
    method: 'POST',
    body: JSON.stringify({
      variant_id: payload.variant_id,
      quantity: payload.quantity,
      comment: (payload.comment ?? '').trim() || null,
      receipt_date: (payload.receipt_date ?? '').trim() || null,
      receipt_status: payload.receipt_status ?? 'accepted',
    }),
  })
}

export type ReceiptDetail = {
  id: string
  variant_id: string | null
  sku: string
  color_id: string | null
  size_id: string | null
  quantity: number
  comment: string | null
  product_id: string
  product_name: string
  product_type_name: string | null
  client_id: string | null
  client_name: string | null
  length: number
  width: number
  height: number
  first_image_url: string | null
  created_at: string
  created_by: string | null
  receipt_status: 'pending' | 'accepted'
}

export function getReceipt(receiptId: string) {
  return request<ReceiptDetail>(`/receipts/${encodeURIComponent(receiptId.trim())}`)
}

export function patchReceipt(
  receiptId: string,
  payload: {
    quantity?: number
    comment?: string | null
    variant_id?: string
    receipt_date?: string | null
    receipt_status?: 'pending' | 'accepted'
  },
) {
  return request<{ message: string }>(`/receipts/${encodeURIComponent(receiptId.trim())}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export type ShipmentDetail = {
  id: string
  variant_id: string | null
  sku: string
  color_id: string | null
  size_id: string | null
  quantity: number
  comment: string | null
  shipment_status: 'pending' | 'shipped'
  product_id: string
  product_name: string
  product_type_name: string | null
  client_id: string | null
  client_name: string | null
  length: number
  width: number
  height: number
  first_image_url: string | null
  created_at: string
  created_by: string | null
}

export function createShipment(payload: {
  variant_id: string
  quantity: number
  comment?: string | null
  shipment_date?: string | null
  shipment_status: 'pending' | 'shipped'
}) {
  return request<{ message: string }>('/shipments', {
    method: 'POST',
    body: JSON.stringify({
      variant_id: payload.variant_id,
      quantity: payload.quantity,
      comment: (payload.comment ?? '').trim() || null,
      shipment_date: (payload.shipment_date ?? '').trim() || null,
      shipment_status: payload.shipment_status,
    }),
  })
}

export function getShipment(shipmentId: string) {
  return request<ShipmentDetail>(`/shipments/${encodeURIComponent(shipmentId.trim())}`)
}

export function patchShipment(
  shipmentId: string,
  payload: {
    quantity?: number
    comment?: string | null
    variant_id?: string
    shipment_date?: string | null
    shipment_status?: 'pending' | 'shipped'
  },
) {
  return request<{ message: string }>(`/shipments/${encodeURIComponent(shipmentId.trim())}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export type InventoryOperationsListParams = {
  page?: number
  limit?: number
  op_type?: InventoryOpType | ''
  client_id?: string
  product_id?: string
  supplier_id?: string
  color_id?: string
  size_id?: string
  sku?: string
  name?: string
  date_from?: string
  date_to?: string
  receipt_status?: 'pending' | 'accepted' | ''
  shipment_status?: 'pending' | 'shipped' | ''
  sort?: string
}

export function getInventoryOperations(params?: InventoryOperationsListParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.op_type) sp.set('op_type', params.op_type)
  if (params?.client_id) sp.set('client_id', params.client_id)
  if (params?.product_id) sp.set('product_id', params.product_id)
  if (params?.supplier_id) sp.set('supplier_id', params.supplier_id)
  if (params?.color_id) sp.set('color_id', params.color_id)
  if (params?.size_id) sp.set('size_id', params.size_id)
  if (params?.sku?.trim()) sp.set('sku', params.sku.trim())
  if (params?.name?.trim()) sp.set('name', params.name.trim())
  if (params?.date_from && /^\d{4}-\d{2}-\d{2}$/.test(params.date_from)) {
    sp.set('date_from', params.date_from)
  }
  if (params?.date_to && /^\d{4}-\d{2}-\d{2}$/.test(params.date_to)) {
    sp.set('date_to', params.date_to)
  }
  if (params?.receipt_status === 'pending' || params?.receipt_status === 'accepted') {
    sp.set('receipt_status', params.receipt_status)
  }
  if (params?.shipment_status === 'pending' || params?.shipment_status === 'shipped') {
    sp.set('shipment_status', params.shipment_status)
  }
  if (params?.sort) sp.set('sort', params.sort)
  const q = sp.toString()
  return request<InventoryOperationListResponse>(
    q ? `/inventory/operations?${q}` : '/inventory/operations',
  )
}

export type InventoryBalancesListParams = {
  page?: number
  limit?: number
  client_id?: string
  product_id?: string
  type_id?: string
  supplier_id?: string
  color_id?: string
  size_id?: string
  sku?: string
  name?: string
  only_positive?: boolean
  sort?: string
}

export function getInventoryBalances(params?: InventoryBalancesListParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.client_id) sp.set('client_id', params.client_id)
  if (params?.product_id) sp.set('product_id', params.product_id)
  if (params?.type_id) sp.set('type_id', params.type_id)
  if (params?.supplier_id) sp.set('supplier_id', params.supplier_id)
  if (params?.color_id) sp.set('color_id', params.color_id)
  if (params?.size_id) sp.set('size_id', params.size_id)
  if (params?.sku?.trim()) sp.set('sku', params.sku.trim())
  if (params?.name?.trim()) sp.set('name', params.name.trim())
  if (params?.only_positive === false) sp.set('only_positive', 'false')
  if (params?.sort) sp.set('sort', params.sort)
  const q = sp.toString()
  return request<InventoryBalanceListResponse>(
    q ? `/inventory/balances?${q}` : '/inventory/balances',
  )
}

export function createInventoryOperation(payload: {
  op_type: InventoryOpType
  client_id: string
  product_id: string
  color_id?: string | null
  size_id?: string | null
  quantity: number
  note?: string | null
}) {
  return request<{ message: string }>('/inventory/operations', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
