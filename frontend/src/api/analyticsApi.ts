import { request } from './http'
import type {
  AdminDashboardReport,
  AnalyticsCommonParams,
  AnalyticsGroup,
  BalanceReport,
  ByTypeReport,
  ClientActivityReport,
  DeadStockReport,
  MovementReport,
  StockSnapshotReport,
  TopProductsReport,
} from './domainTypes'

function appendCommon(sp: URLSearchParams, p: AnalyticsCommonParams | undefined) {
  if (!p) return
  if (p.date_from && /^\d{4}-\d{2}-\d{2}$/.test(p.date_from)) sp.set('date_from', p.date_from)
  if (p.date_to && /^\d{4}-\d{2}-\d{2}$/.test(p.date_to)) sp.set('date_to', p.date_to)
  if (p.client_ids?.length) {
    for (const id of p.client_ids) {
      const t = id.trim()
      if (t) sp.append('client_ids', t)
    }
  } else if (p.client_id?.trim()) {
    sp.append('client_ids', p.client_id.trim())
  }
  if (p.product_id) sp.set('product_id', p.product_id)
  if (p.type_id) sp.set('type_id', p.type_id)
}

export function getAnalyticsMovement(params?: AnalyticsCommonParams & { group?: AnalyticsGroup }) {
  const sp = new URLSearchParams()
  if (params?.group) sp.set('group', params.group)
  appendCommon(sp, params)
  const q = sp.toString()
  return request<MovementReport>(q ? `/analytics/movement?${q}` : '/analytics/movement')
}

export function getAnalyticsStockSnapshot(
  params?: Omit<AnalyticsCommonParams, 'date_from' | 'date_to'> & {
    at_date?: string
    only_positive?: boolean
    limit?: number
  },
) {
  const sp = new URLSearchParams()
  if (params?.at_date && /^\d{4}-\d{2}-\d{2}$/.test(params.at_date)) {
    sp.set('at_date', params.at_date)
  }
  appendCommon(sp, {
    client_ids: params?.client_ids,
    client_id: params?.client_id,
    product_id: params?.product_id,
    type_id: params?.type_id,
  })
  if (params?.only_positive === false) sp.set('only_positive', 'false')
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<StockSnapshotReport>(
    q ? `/analytics/stock-snapshot?${q}` : '/analytics/stock-snapshot',
  )
}

export function getAnalyticsTopProducts(params?: AnalyticsCommonParams & { limit?: number }) {
  const sp = new URLSearchParams()
  appendCommon(sp, params)
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<TopProductsReport>(q ? `/analytics/top-products?${q}` : '/analytics/top-products')
}

export function getAnalyticsDeadStock(params?: {
  days?: number
  client_ids?: string[]
  client_id?: string
  type_id?: string
  limit?: number
}) {
  const sp = new URLSearchParams()
  if (params?.days != null) sp.set('days', String(params.days))
  if (params?.client_ids?.length) {
    for (const id of params.client_ids) {
      const t = id.trim()
      if (t) sp.append('client_ids', t)
    }
  } else if (params?.client_id) sp.append('client_ids', params.client_id.trim())
  if (params?.type_id) sp.set('type_id', params.type_id)
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<DeadStockReport>(q ? `/analytics/dead-stock?${q}` : '/analytics/dead-stock')
}

export function getAnalyticsClientActivity(params?: AnalyticsCommonParams & { limit?: number }) {
  const sp = new URLSearchParams()
  appendCommon(sp, params)
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<ClientActivityReport>(
    q ? `/analytics/client-activity?${q}` : '/analytics/client-activity',
  )
}

export function getAnalyticsBalance(params?: AnalyticsCommonParams) {
  const sp = new URLSearchParams()
  appendCommon(sp, params)
  const q = sp.toString()
  return request<BalanceReport>(q ? `/analytics/balance?${q}` : '/analytics/balance')
}

export function getAnalyticsByType(params?: Omit<AnalyticsCommonParams, 'product_id' | 'type_id'>) {
  const sp = new URLSearchParams()
  appendCommon(sp, params)
  const q = sp.toString()
  return request<ByTypeReport>(q ? `/analytics/by-type?${q}` : '/analytics/by-type')
}

export function getAnalyticsAdminDashboard(
  params?: AnalyticsCommonParams & {
    movement_clients_limit?: number
  },
) {
  const sp = new URLSearchParams()
  appendCommon(sp, params)
  if (params?.movement_clients_limit != null) {
    sp.set('movement_clients_limit', String(params.movement_clients_limit))
  }
  const q = sp.toString()
  return request<AdminDashboardReport>(
    q ? `/analytics/admin-dashboard?${q}` : '/analytics/admin-dashboard',
  )
}
