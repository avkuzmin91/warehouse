/**
 * Вызовы API, защищённые на бэкенде ролью admin (и DELETE receipt/shipment).
 * Импортируйте только из lazy-чанков админки / общих форм, где нужны эти методы.
 */
import { RECORD_ACTUALITY_YES_ID } from './constants'
import { request, requestForm } from './http'
import type {
  AdminDashboardReport,
  AnalyticsCommonParams,
  AnalyticsGroup,
  BalanceReport,
  ByTypeReport,
  ClientActivityReport,
  DeadStockReport,
  DictionaryItem,
  DictionaryListQueryParams,
  DictionaryListResponse,
  MovementReport,
  ProductItem,
  ProductListQueryParams,
  ProductListResponse,
  ProductTypeDictionaryItem,
  ProductTypeListResponse,
  ProductVariantItem,
  ProductVariantWriteItem,
  RecordActualityFilterItem,
  SimpleDictionaryListParams,
  SizeItem,
  SizeListQueryParams,
  SizeListResponse,
  StockSnapshotReport,
  TopProductsReport,
  UserListItem,
} from '../api'

export function getUsers() {
  return request<UserListItem[]>('/users')
}

export function updateUserRole(userId: string, role: 'user' | 'manager' | 'client') {
  return request<{ message: string }>(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export function updateUserClient(userId: string, clientId: string | null) {
  return request<{ message: string }>(`/users/${userId}/client`, {
    method: 'PATCH',
    body: JSON.stringify({ client_id: clientId }),
  })
}

export function deleteUser(userId: string) {
  return request<{ message: string }>(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_deleted: true }),
  })
}

export function fetchRecordActualityFilterItems() {
  return request<RecordActualityFilterItem[]>('/system/record-actuality')
}

export function getClients(params?: DictionaryListQueryParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.search != null && params.search.trim() !== '') sp.set('search', params.search.trim())
  if (params?.actuality_id != null && params.actuality_id.trim() !== '') {
    sp.set('actuality_id', params.actuality_id.trim())
  }
  if (params?.date_from != null && /^\d{4}-\d{2}-\d{2}$/.test(params.date_from.trim())) {
    sp.set('date_from', params.date_from.trim())
  }
  if (params?.date_to != null && /^\d{4}-\d{2}-\d{2}$/.test(params.date_to.trim())) {
    sp.set('date_to', params.date_to.trim())
  }
  if (params?.sort != null && params.sort.trim() !== '') sp.set('sort', params.sort.trim())
  const q = sp.toString()
  return request<DictionaryListResponse>(q ? `/clients?${q}` : '/clients')
}

export function getSizes(params?: SizeListQueryParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.name != null && params.name.trim() !== '') sp.set('name', params.name.trim())
  if (params?.actuality_id != null && params.actuality_id.trim() !== '') {
    sp.set('actuality_id', params.actuality_id.trim())
  }
  if (params?.sort != null && params.sort.trim() !== '') sp.set('sort', params.sort.trim())
  const q = sp.toString()
  return request<SizeListResponse>(q ? `/sizes?${q}` : '/sizes')
}

export function getSize(id: string) {
  return request<SizeItem>(`/sizes/${id}`)
}

export function createSize(payload: { name: string; is_active: boolean }) {
  return request<{ message: string }>('/sizes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateSize(id: string, payload: { name?: string; is_active?: boolean }) {
  return request<{ message: string }>(`/sizes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function fetchSimpleDictionaryPage(
  apiPath: string,
  nameQueryKey: 'name' | 'search',
  params?: SimpleDictionaryListParams,
) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (nameQueryKey === 'name' && params?.name != null && params.name.trim() !== '') {
    sp.set('name', params.name.trim())
  }
  if (nameQueryKey === 'search' && params?.search != null && params.search.trim() !== '') {
    sp.set('search', params.search.trim())
  }
  if (params?.actuality_id != null && params.actuality_id.trim() !== '') {
    sp.set('actuality_id', params.actuality_id.trim())
  }
  if (params?.date_from != null && /^\d{4}-\d{2}-\d{2}$/.test(params.date_from.trim())) {
    sp.set('date_from', params.date_from.trim())
  }
  if (params?.date_to != null && /^\d{4}-\d{2}-\d{2}$/.test(params.date_to.trim())) {
    sp.set('date_to', params.date_to.trim())
  }
  if (params?.sort != null && params.sort.trim() !== '') sp.set('sort', params.sort.trim())
  const q = sp.toString()
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  return request<DictionaryListResponse>(q ? `${path}?${q}` : path)
}

export function getSimpleDictionaryById(apiPath: string, id: string) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  return request<DictionaryItem>(`${path}/${id}`)
}

export function createSimpleDictionaryItem(
  apiPath: string,
  payload: { name: string; is_active: boolean },
) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  return request<{ message: string }>(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateSimpleDictionaryItem(
  apiPath: string,
  id: string,
  payload: { name?: string; is_active?: boolean },
) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  return request<{ message: string }>(`${path}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function fetchProductTypesPage(params?: SimpleDictionaryListParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.name != null && params.name.trim() !== '') {
    sp.set('name', params.name.trim())
  }
  if (params?.actuality_id != null && params.actuality_id.trim() !== '') {
    sp.set('actuality_id', params.actuality_id.trim())
  }
  if (params?.date_from != null && /^\d{4}-\d{2}-\d{2}$/.test(params.date_from.trim())) {
    sp.set('date_from', params.date_from.trim())
  }
  if (params?.date_to != null && /^\d{4}-\d{2}-\d{2}$/.test(params.date_to.trim())) {
    sp.set('date_to', params.date_to.trim())
  }
  if (params?.sort != null && params.sort.trim() !== '') sp.set('sort', params.sort.trim())
  const q = sp.toString()
  return request<ProductTypeListResponse>(q ? `/product-types?${q}` : '/product-types')
}

export function getProductTypeById(id: string) {
  return request<ProductTypeDictionaryItem>(`/product-types/${id}`)
}

export function createProductType(payload: {
  name: string
  is_active: boolean
  requires_color: boolean
  requires_size: boolean
}) {
  return request<{ message: string }>('/product-types', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateProductType(
  id: string,
  payload: {
    name?: string
    is_active?: boolean
    requires_color?: boolean
    requires_size?: boolean
  },
) {
  return request<{ message: string }>(`/product-types/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function getDictionaryItem(kind: 'clients', id: string) {
  return request<DictionaryItem>(`/${kind}/${id}`)
}

export function createDictionaryItem(kind: 'clients', payload: { name: string; is_active: boolean }) {
  return request<{ message: string }>(`/${kind}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateDictionaryItem(
  kind: 'clients',
  id: string,
  payload: { name?: string; is_active?: boolean },
) {
  return request<{ message: string }>(`/${kind}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function fetchActiveDictionaryItems(apiPath: string): Promise<DictionaryItem[]> {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  const nameQueryKey: 'name' | 'search' = path === '/clients' ? 'search' : 'name'
  const res = await fetchSimpleDictionaryPage(path, nameQueryKey, {
    page: 1,
    limit: 100,
    actuality_id: RECORD_ACTUALITY_YES_ID,
    sort: 'name_asc',
  })
  return res.items
}

export async function fetchAllDictionaryItemsForFilter(
  apiPath: string,
  nameQueryKey: 'name' | 'search' = 'name',
): Promise<DictionaryItem[]> {
  const limit = 100
  let page = 1
  const all: DictionaryItem[] = []
  const maxPages = 50
  while (page <= maxPages) {
    const res = await fetchSimpleDictionaryPage(apiPath, nameQueryKey, {
      page,
      limit,
      sort: 'name_asc',
    })
    all.push(...res.items)
    if (res.items.length < limit || all.length >= res.total) break
    page += 1
  }
  return all
}

export function getProducts(params?: ProductListQueryParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.name != null && params.name.trim() !== '') sp.set('name', params.name.trim())
  if (params?.sku != null && params.sku.trim() !== '') sp.set('sku', params.sku.trim())
  if (params?.type_id != null && params.type_id.trim() !== '') {
    sp.set('type_id', params.type_id.trim())
  }
  if (params?.client_id != null && params.client_id.trim() !== '') {
    sp.set('client_id', params.client_id.trim())
  }
  if (params?.actuality_id != null && params.actuality_id.trim() !== '') {
    sp.set('actuality_id', params.actuality_id.trim())
  }
  if (params?.sort != null && params.sort.trim() !== '') sp.set('sort', params.sort.trim())
  const q = sp.toString()
  return request<ProductListResponse>(q ? `/products?${q}` : '/products')
}

export function getProduct(id: string) {
  return request<ProductItem>(`/products/${id}`)
}

export function createProduct(payload: {
  meta: {
    product: {
      name: string
      type_id: string
      sku_base: string
      client_id: string
      is_active: boolean
    }
    colors: string[]
    dimensions: { length: number; width: number; height: number; sizes: string[] }[]
  }
  images: File[]
}) {
  const form = new FormData()
  form.append('meta', JSON.stringify(payload.meta))
  for (const file of payload.images) {
    form.append('images', file)
  }
  return requestForm<{ message: string }>('/products', {
    method: 'POST',
    body: form,
  })
}

export function updateProduct(
  id: string,
  payload: {
    name?: string
    type_id?: string
    client_id?: string | null
    is_active?: boolean
    is_deleted?: boolean
    sku_base?: string
    image_urls?: string[]
  },
) {
  return request<{ message: string }>(`/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function getProductVariants(productId: string) {
  return request<ProductVariantItem[]>(`/products/${productId}/variants`)
}

export function patchProductVariants(productId: string, variants: ProductVariantWriteItem[]) {
  return request<{ message: string }>(`/products/${productId}/variants`, {
    method: 'PATCH',
    body: JSON.stringify({ variants }),
  })
}

export function deleteProductVariant(productId: string, variantId: string) {
  return request<{ message: string }>(`/products/${productId}/variants/${variantId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_deleted: true }),
  })
}

export function uploadProductDictionaryImage(file: File) {
  const form = new FormData()
  form.append('image', file)
  return requestForm<{ url: string }>('/products/upload-image', {
    method: 'POST',
    body: form,
  })
}

export function deleteProduct(id: string) {
  return request<{ message: string }>(`/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_deleted: true }),
  })
}

export function deleteReceipt(receiptId: string) {
  return request<{ message: string }>(`/receipts/${encodeURIComponent(receiptId.trim())}`, {
    method: 'DELETE',
  })
}

export function deleteShipment(shipmentId: string) {
  return request<{ message: string }>(`/shipments/${encodeURIComponent(shipmentId.trim())}`, {
    method: 'DELETE',
  })
}

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
