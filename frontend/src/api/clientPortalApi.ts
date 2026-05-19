import { request } from './http'
import type {
  AnalyticsPeriod,
  AnalyticsCommonParams,
  AnalyticsGroup,
  DeadStockReport,
  DictionaryItem,
  InventoryBalanceListResponse,
  InventoryOpType,
  InventoryOperationListResponse,
  InventoryProductTypeLookup,
  MovementReport,
  ProductItem,
  ProductListQueryParams,
  ProductListResponse,
  RecordActualityFilterItem,
  TopProductsReport,
} from './domainTypes'

export type {
  AnalyticsGroup,
  AnalyticsPeriod,
  DeadStockReport,
  DictionaryItem,
  InventoryBalanceItem,
  InventoryOpType,
  InventoryOperationItem,
  MovementReport,
  ProductItem,
  ProductVariantItem,
  RecordActualityFilterItem,
  TopProductsReport,
} from './domainTypes'

export type ClientPortalProductListQueryParams = Omit<ProductListQueryParams, 'client_id'>

export function getClientPortalProductCatalog(params?: ClientPortalProductListQueryParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.name != null && params.name.trim() !== '') sp.set('name', params.name.trim())
  if (params?.sku != null && params.sku.trim() !== '') sp.set('sku', params.sku.trim())
  if (params?.type_id != null && params.type_id.trim() !== '') {
    sp.set('type_id', params.type_id.trim())
  }
  if (params?.actuality_id != null && params.actuality_id.trim() !== '') {
    sp.set('actuality_id', params.actuality_id.trim())
  }
  if (params?.sort != null && params.sort.trim() !== '') sp.set('sort', params.sort.trim())
  const q = sp.toString()
  return request<ProductListResponse>(q ? `/client-portal/products?${q}` : '/client-portal/products')
}

export function getClientPortalProduct(id: string) {
  return request<ProductItem>(`/client-portal/products/${id}`)
}

export function getClientPortalProductVariants(productId: string) {
  return request<import('./domainTypes').ProductVariantItem[]>(`/client-portal/products/${productId}/variants`)
}

export type ClientPortalBalancesParams = {
  page?: number
  limit?: number
  product_id?: string
  type_id?: string
  color_id?: string
  size_id?: string
  sku?: string
  name?: string
  search?: string
  only_positive?: boolean
  sort?: string
}

export function getClientPortalBalances(params?: ClientPortalBalancesParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.product_id) sp.set('product_id', params.product_id)
  if (params?.type_id) sp.set('type_id', params.type_id)
  if (params?.color_id) sp.set('color_id', params.color_id)
  if (params?.size_id) sp.set('size_id', params.size_id)
  if (params?.sku?.trim()) sp.set('sku', params.sku.trim())
  if (params?.name?.trim()) sp.set('name', params.name.trim())
  else if (params?.search?.trim()) sp.set('search', params.search.trim())
  if (params?.only_positive === false) sp.set('only_positive', 'false')
  if (params?.sort) sp.set('sort', params.sort)
  const q = sp.toString()
  return request<InventoryBalanceListResponse>(
    q ? `/client-portal/balances?${q}` : '/client-portal/balances',
  )
}

export type ClientPortalOperationsParams = {
  page?: number
  limit?: number
  op_type?: InventoryOpType | ''
  product_id?: string
  color_id?: string
  size_id?: string
  sku?: string
  name?: string
  search?: string
  date_from?: string
  date_to?: string
  receipt_status?: 'pending' | 'accepted'
  shipment_status?: 'pending' | 'shipped'
  sort?: string
}

export function getClientPortalOperations(params?: ClientPortalOperationsParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.op_type) sp.set('op_type', params.op_type)
  if (params?.product_id) sp.set('product_id', params.product_id)
  if (params?.color_id) sp.set('color_id', params.color_id)
  if (params?.size_id) sp.set('size_id', params.size_id)
  if (params?.sku?.trim()) sp.set('sku', params.sku.trim())
  if (params?.name?.trim()) sp.set('name', params.name.trim())
  else if (params?.search?.trim()) sp.set('search', params.search.trim())
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
    q ? `/client-portal/operations?${q}` : '/client-portal/operations',
  )
}

export function getClientPortalProductTypes() {
  return request<InventoryProductTypeLookup[]>('/client-portal/lookups/product-types')
}

export function getClientPortalRecordActualityFilterItems() {
  return request<RecordActualityFilterItem[]>('/client-portal/lookups/record-actuality')
}

export function getClientPortalColors() {
  return request<DictionaryItem[]>('/client-portal/lookups/colors')
}

export function getClientPortalSizes() {
  return request<DictionaryItem[]>('/client-portal/lookups/sizes')
}

export type ClientPortalDashboardMetrics = {
  total_stock: number
  period_inflow: number
  period_outflow: number
  period: AnalyticsPeriod
}

export function getClientPortalDashboardMetrics(params?: { date_from?: string; date_to?: string }) {
  const sp = new URLSearchParams()
  if (params?.date_from && /^\d{4}-\d{2}-\d{2}$/.test(params.date_from)) {
    sp.set('date_from', params.date_from)
  }
  if (params?.date_to && /^\d{4}-\d{2}-\d{2}$/.test(params.date_to)) {
    sp.set('date_to', params.date_to)
  }
  const q = sp.toString()
  return request<ClientPortalDashboardMetrics>(
    q ? `/client-portal/dashboard/metrics?${q}` : '/client-portal/dashboard/metrics',
  )
}

export function getClientPortalDashboardMovement(
  params?: AnalyticsCommonParams & { group?: AnalyticsGroup },
) {
  const sp = new URLSearchParams()
  if (params?.group) sp.set('group', params.group)
  if (params?.date_from && /^\d{4}-\d{2}-\d{2}$/.test(params.date_from)) {
    sp.set('date_from', params.date_from)
  }
  if (params?.date_to && /^\d{4}-\d{2}-\d{2}$/.test(params.date_to)) {
    sp.set('date_to', params.date_to)
  }
  if (params?.product_id) sp.set('product_id', params.product_id)
  if (params?.type_id) sp.set('type_id', params.type_id)
  const q = sp.toString()
  return request<MovementReport>(
    q ? `/client-portal/dashboard/movement?${q}` : '/client-portal/dashboard/movement',
  )
}

export function getClientPortalDashboardTopProducts(
  params?: { date_from?: string; date_to?: string; type_id?: string; limit?: number },
) {
  const sp = new URLSearchParams()
  if (params?.date_from && /^\d{4}-\d{2}-\d{2}$/.test(params.date_from)) {
    sp.set('date_from', params.date_from)
  }
  if (params?.date_to && /^\d{4}-\d{2}-\d{2}$/.test(params.date_to)) {
    sp.set('date_to', params.date_to)
  }
  if (params?.type_id) sp.set('type_id', params.type_id)
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<TopProductsReport>(
    q ? `/client-portal/dashboard/top-products?${q}` : '/client-portal/dashboard/top-products',
  )
}

const DEAD_STOCK_DAYS_MIN = 1
const DEAD_STOCK_DAYS_MAX = 3650

export function getClientPortalDashboardDeadStock(params?: {
  days?: number
  type_id?: string
  limit?: number
}) {
  const sp = new URLSearchParams()
  if (params?.days != null) {
    const d = Math.min(DEAD_STOCK_DAYS_MAX, Math.max(DEAD_STOCK_DAYS_MIN, Math.floor(params.days)))
    sp.set('days', String(d))
  }
  if (params?.type_id) sp.set('type_id', params.type_id)
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<DeadStockReport>(
    q ? `/client-portal/dashboard/dead-stock?${q}` : '/client-portal/dashboard/dead-stock',
  )
}
