/**
 * Вызовы API, защищённые на бэкенде ролью admin (и DELETE receipt/shipment).
 * Импортируйте только из lazy-чанков админки / общих форм, где нужны эти методы.
 */
import { request, requestForm } from './http'
import type {
  ClientStoreItem,
  DictionaryItem,
  DictionaryListQueryParams,
  DictionaryListResponse,
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
  UserListItem,
} from './domainTypes'

export function getUsers() {
  return request<UserListItem[]>('/users')
}

export function updateUserRole(userId: string, role: 'user' | 'manager' | 'warehouse_manager' | 'shift_supervisor' | 'warehouse_head' | 'client') {
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

export function setUnloadingZonePacking(id: string) {
  return request<{ message: string }>(`/unloading-zones/${id}/set-packing`, { method: 'POST' })
}

export function setUnloadingZoneShipping(id: string) {
  return request<{ message: string }>(`/unloading-zones/${id}/set-shipping`, { method: 'POST' })
}

export function createSimpleDictionaryItem(
  apiPath: string,
  payload: { name: string; is_active: boolean; color_hex?: string | null; rent_monthly_kopecks?: number | null },
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
  payload: { name?: string; is_active?: boolean; color_hex?: string | null; rent_monthly_kopecks?: number | null },
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

export function getClientStores(clientId: string, includeDeleted = false) {
  const q = includeDeleted ? '?include_deleted=true' : ''
  return request<ClientStoreItem[]>(`/clients/${clientId}/stores${q}`)
}

export function createClientStore(clientId: string, payload: { name: string; is_active: boolean }) {
  return request<{ message: string }>(`/clients/${clientId}/stores`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateClientStore(
  clientId: string,
  storeId: string,
  payload: { name?: string; is_active?: boolean; is_deleted?: boolean },
) {
  return request<{ message: string }>(`/clients/${clientId}/stores/${storeId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteClientStore(clientId: string, storeId: string) {
  return request<{ message: string }>(`/clients/${clientId}/stores/${storeId}`, {
    method: 'DELETE',
  })
}

export function getProducts(params?: ProductListQueryParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.search != null && params.search.trim() !== '') sp.set('search', params.search.trim())
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
  if (params?.sku_pending != null) sp.set('sku_pending', params.sku_pending ? 'true' : 'false')
  if (params?.sort != null && params.sort.trim() !== '') sp.set('sort', params.sort.trim())
  const q = sp.toString()
  return request<ProductListResponse>(q ? `/products?${q}` : '/products')
}

export function getProduct(id: string, signal?: AbortSignal) {
  return request<ProductItem>(`/products/${id}`, { signal })
}

export function createProduct(payload: {
  meta: {
    product: {
      name: string
      type_id: string
      sku_base?: string | null
      sku_pending?: boolean
      weight_grams?: number | null
      items_per_pallet?: number | null
      client_id: string
      is_active: boolean
      packing_price_good_kop?: number | null
      packing_price_defect_kop?: number | null
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
    sku_pending?: boolean
    weight_grams?: number | null
    items_per_pallet?: number | null
    image_urls?: string[]
  },
) {
  return request<{ message: string }>(`/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteProduct(id: string) {
  return request<{ message: string }>(`/products/${id}`, { method: 'DELETE' })
}

export function getProductVariants(productId: string, signal?: AbortSignal) {
  return request<ProductVariantItem[]>(`/products/${productId}/variants`, { signal })
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

