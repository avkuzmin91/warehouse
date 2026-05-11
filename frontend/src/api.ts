function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim().replace(/\/$/, '')
  }
  return '/api'
}

/** База URL API: только относительный `/api`; прокси (Vite/nginx) отправляет запрос на backend без этого префикса. */
export const API_BASE_URL = resolveApiBaseUrl()

/** Пути с API (`/uploads/...`) в `<img>` на другом origin; полные URL не трогаем. */
export function resolvePublicUploadSrc(url: string): string {
  const s = String(url).trim()
  if (!s) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('/')) return `${API_BASE_URL}${s}`
  return s
}

/** ID «Актуален» в системном справочнике актуальности (совпадает с backend `RECORD_ACTUALITY_YES_ID`). */
export const RECORD_ACTUALITY_YES_ID = '00000000-0000-4000-8000-000000000001'

export type User = {
  id: string
  email: string
  role: 'user' | 'manager' | 'admin' | 'client' | 'warehouse_manager'
  /** Справочник клиента (роль client); задаётся администратором. */
  client_id?: string | null
}

type AuthResponse = {
  token: string
}

export type UserListItem = {
  id: string
  email: string
  role: 'user' | 'manager' | 'admin' | 'client' | 'warehouse_manager'
  created_at: string
  client_id?: string | null
  client_name?: string | null
}

export type DictionaryItem = {
  id: string
  name: string
  is_active: boolean
  is_deleted?: boolean
  deleted_at?: string | null
  deleted_by?: string | null
  created_at: string
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

/** Тип товара: учёт вариантов по цвету и размеру. */
export type ProductTypeDictionaryItem = DictionaryItem & {
  requires_color: boolean
  requires_size: boolean
}

export type SizeItem = {
  id: string
  name: string
  is_active: boolean
  is_deleted?: boolean
  deleted_at?: string | null
  deleted_by?: string | null
  created_at: string
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

export type SizeListResponse = {
  items: SizeItem[]
  total: number
  page: number
  limit: number
}

export type ProductVariantDimension = {
  length: number
  width: number
  height: number
}

export type ProductVariantItem = {
  id: string
  color_id: string
  dimension: ProductVariantDimension
  size_id: string | null
  sku: string
  images: string[]
  is_active: boolean
}

export type ProductVariantWriteItem = {
  id: string | null
  sku?: string | null
  color_id: string
  dimension: ProductVariantDimension
  size_id: string | null
  images: string[]
  is_active: boolean
}

export type ProductItem = {
  id: string
  name: string
  type_id: string
  type_name: string | null
  sku_base: string
  requires_color: boolean
  requires_size: boolean
  client_id: string | null
  client_name: string | null
  variant_count: number
  /** Product: true = товар актуален, false = не актуален; по умолчанию true */
  is_active: boolean
  is_deleted?: boolean
  deleted_at?: string | null
  deleted_by?: string | null
  created_at: string
  /** Email пользователя-создателя (ТЗ: created_by) */
  created_by: string | null
  updated_at: string | null
  /** Email последнего редактора (ТЗ: updated_by) */
  updated_by: string | null
  /** Порядок фото карточки; первое — превью в списке. */
  image_urls?: string[]
}

export type ProductListResponse = {
  items: ProductItem[]
  total: number
  page: number
  limit: number
}

function getToken() {
  return localStorage.getItem('token')
}

const ME_CACHE_MS = 15_000
let meCache: { user: User; token: string; expires: number } | null = null
let meInFlight: Promise<User> | null = null

export function clearProfileCache() {
  meCache = null
  meInFlight = null
}

export function saveToken(token: string) {
  localStorage.setItem('token', token)
  clearProfileCache()
}

export function clearToken() {
  localStorage.removeItem('token')
  clearProfileCache()
}

/** Разбирает JSON-тело ошибки FastAPI/Starlette (detail строка, массив validation errors и т.д.). */
function formatApiErrorDetail(body: unknown, httpStatus: number): string {
  const fallback =
    httpStatus > 0
      ? `Запрос не выполнен (код ${httpStatus}). Повторите попытку или обратитесь к администратору.`
      : 'Не удалось выполнить запрос. Повторите попытку или обратитесь к администратору.'

  if (body === null || body === undefined) {
    return fallback
  }
  if (typeof body === 'string' && body.trim()) {
    return body.trim()
  }
  if (typeof body !== 'object') {
    return fallback
  }

  const o = body as Record<string, unknown>
  const detail = o.detail

  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim()
  }

  if (Array.isArray(detail)) {
    const parts: string[] = []
    for (const item of detail) {
      if (typeof item === 'string' && item.trim()) {
        parts.push(item.trim())
        continue
      }
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>
        const msg =
          typeof rec.msg === 'string'
            ? rec.msg.trim()
            : typeof rec.message === 'string'
              ? rec.message.trim()
              : ''
        if (msg) {
          const locRaw = rec.loc
          const loc =
            Array.isArray(locRaw) && locRaw.length
              ? locRaw
                  .filter((x) => x !== 'body')
                  .map((x) => String(x))
                  .join('.')
              : ''
          parts.push(loc ? `${loc}: ${msg}` : msg)
        }
      }
    }
    if (parts.length) {
      return parts.join(' ')
    }
  }

  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const rec = detail as Record<string, unknown>
    if (typeof rec.msg === 'string' && rec.msg.trim()) {
      return rec.msg.trim()
    }
    if (typeof rec.message === 'string' && rec.message.trim()) {
      return rec.message.trim()
    }
  }

  if (typeof o.message === 'string' && o.message.trim()) {
    return o.message.trim()
  }

  return fallback
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (init?.headers) {
    Object.assign(headers, init.headers as Record<string, string>)
  }

  if (token) {
    const publicAuth = path === '/auth/login' || path === '/auth/register'
    if (!publicAuth) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'Сервер API недоступен. Запустите бэкенд: в папке backend выполните python -m uvicorn main:app --host 127.0.0.1 --port 8000',
      )
    }
    throw error
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }

  return response.json() as Promise<T>
}

/** Публичный GET /version: версия и окружение для футера (без Bearer). */
export async function fetchSystemVersion(): Promise<{ version: string; environment: string }> {
  const response = await fetch(`${API_BASE_URL}/version`, { method: 'GET' })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }
  return response.json() as Promise<{ version: string; environment: string }>
}

async function requestForm<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (init?.headers) {
    Object.assign(headers, init.headers as Record<string, string>)
  }
  if (token) {
    const publicAuth = path === '/auth/login' || path === '/auth/register'
    if (!publicAuth) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        'Сервер API недоступен. Запустите бэкенд: в папке backend выполните python -m uvicorn main:app --host 127.0.0.1 --port 8000',
      )
    }
    throw error
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }
  return response.json() as Promise<T>
}

export function register(email: string, password: string) {
  return request<{ success: boolean }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function login(email: string, password: string) {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<AuthResponse>('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
}

export function me(): Promise<User> {
  const token = getToken()
  if (!token) {
    return Promise.reject(new Error('Недействительный токен'))
  }
  if (meCache && meCache.token === token && Date.now() < meCache.expires) {
    return Promise.resolve(meCache.user)
  }
  if (meInFlight) {
    return meInFlight
  }
  meInFlight = request<User>('/auth/me')
    .then((user) => {
      const t = getToken()
      if (t) {
        meCache = { user, token: t, expires: Date.now() + ME_CACHE_MS }
      }
      return user
    })
    .catch((e) => {
      clearProfileCache()
      throw e
    })
    .finally(() => {
      meInFlight = null
    })
  return meInFlight
}

export function getUsers() {
  return request<UserListItem[]>('/users')
}

/** Роли, которые можно назначить через PATCH /users/:id/role (не admin). */
export type AssignableUserRole = 'user' | 'manager' | 'client'

export function updateUserRole(userId: string, role: AssignableUserRole) {
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

export type DictionaryListResponse = {
  items: DictionaryItem[]
  total: number
  page: number
  limit: number
}

export type ProductTypeListResponse = {
  items: ProductTypeDictionaryItem[]
  total: number
  page: number
  limit: number
}

export type DictionaryListQueryParams = {
  page?: number
  limit?: number
  search?: string
  actuality_id?: string
  sort?: string
  date_from?: string
  date_to?: string
}

/** Системный справочник для фильтра актуальности (не отображается в разделе справочников). */
export type RecordActualityFilterItem = {
  id: string
  name: string
}

export function fetchRecordActualityFilterItems() {
  return request<RecordActualityFilterItem[]>('/system/record-actuality')
}

/** Опции `<select>` фильтра актуальности (как у справочных селектов). */
export function buildActualityFilterSelectOptions(
  items: RecordActualityFilterItem[],
  placeholderLabel: string,
): { value: string; label: string }[] {
  return [{ value: '', label: placeholderLabel }, ...items.map((i) => ({ value: i.id, label: i.name }))]
}

/** Список клиентов с пагинацией (GET /clients) */
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

export type SizeListQueryParams = {
  page?: number
  limit?: number
  name?: string
  actuality_id?: string
  sort?: string
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

/** Параметры списка простых справочников (GET с пагинацией): цвета, типы товаров, поставщики */
export type SimpleDictionaryListParams = {
  page?: number
  limit?: number
  name?: string
  search?: string
  actuality_id?: string
  sort?: string
  date_from?: string
  date_to?: string
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

/** Пагинация списка типов товаров (с полями учёта по цвету и размеру). */
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

/** Все записи справочника для фильтров списков (активные и неактивные), с постраничной подгрузкой. */
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

export type ProductListQueryParams = {
  page?: number
  limit?: number
  name?: string
  /** Подстрока по полю штрих-кода товара (p.sku). */
  sku?: string
  type_id?: string
  client_id?: string
  actuality_id?: string
  sort?: string
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
    /** На бэкенде смена типа запрещена; поле игнорируйте. */
    type_id?: string
    client_id?: string | null
    is_active?: boolean
    is_deleted?: boolean
    /** Базовый штрих-код (товар + при необходимости префикс у вариантов). */
    sku_base?: string
    /** Галерея карточки; пустой массив — без фото. */
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

/** Список товаров ЛК клиента: сервер принудительно фильтрует по client_id пользователя. */
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
  return request<ProductVariantItem[]>(`/client-portal/products/${productId}/variants`)
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

// =====================================================================
// Inventory (учёт товаров): операции, остатки, lookup'ы.
// Доступ: менеджер и админ.
// =====================================================================

export type InventoryOpType = 'in' | 'out'

export type InventoryProductTypeLookup = {
  id: string
  name: string
  requires_color: boolean
  requires_size: boolean
}

export type InventoryProductLookup = {
  id: string
  name: string
  sku: string
  type_id: string
  type_name: string
  supplier_id: string | null
  supplier_name: string | null
  requires_color: boolean
  requires_size: boolean
}

export type InventoryOperationItem = {
  id: string
  op_type: InventoryOpType
  client_id: string | null
  client_name: string | null
  product_id: string
  product_name: string
  product_type_id: string | null
  product_type_name: string | null
  supplier_id: string | null
  supplier_name: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  variant_sku?: string | null
  /** Базовый штрих-код товара (карточка), products.sku */
  product_sku?: string | null
  preview_image_url?: string | null
  /** Поступление: ожидает / принят; для отгрузки null */
  receipt_status?: 'pending' | 'accepted' | null
  /** Отгрузка: ожидает / отгружен; для прихода null */
  shipment_status?: 'pending' | 'shipped' | null
  quantity: number
  note: string | null
  created_at: string
  created_by: string | null
}

export type InventoryOperationListResponse = {
  items: InventoryOperationItem[]
  total: number
  page: number
  limit: number
}

export type InventoryBalanceItem = {
  product_id: string
  product_name: string
  /** Базовый штрих-код карточки (products.sku) */
  product_sku: string
  preview_image_url?: string | null
  product_type_id: string | null
  product_type_name: string | null
  client_id: string | null
  client_name: string | null
  supplier_id: string | null
  supplier_name: string | null
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  quantity: number
}

export type InventoryBalanceListResponse = {
  items: InventoryBalanceItem[]
  total: number
  page: number
  limit: number
}

export function getInventoryClients() {
  return request<DictionaryItem[]>('/inventory/lookups/clients')
}
export function getInventoryColors() {
  return request<DictionaryItem[]>('/inventory/lookups/colors')
}

/** Цвета, для которых у товара с данным базовым штрих-кодом есть варианты. */
export function getInventoryColorsForProductSku(sku: string) {
  const s = sku.trim()
  if (!s) return Promise.resolve([] as DictionaryItem[])
  return request<DictionaryItem[]>(
    `/inventory/lookups/colors-for-sku?sku=${encodeURIComponent(s)}`,
  )
}

/** Размеры вариантов для штрих-кода товара и выбранного цвета. */
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

/** Базовые штрих-коды товаров (`products.sku`) для формы приёмки. */
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
  /** Клиент карточки товара (справочник клиентов). */
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

/** Приёмка ТЗ: поиск варианта по штрих-коду и цвету (+ размер для одежды). */
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

/** POST /receipts — приёмка по ТЗ (комментарий опционален). */
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

/** Удаление поступления (только роль admin). */
export function deleteReceipt(receiptId: string) {
  return request<{ message: string }>(`/receipts/${encodeURIComponent(receiptId.trim())}`, {
    method: 'DELETE',
  })
}

/** Удаление отгрузки (только роль admin). */
export function deleteShipment(shipmentId: string) {
  return request<{ message: string }>(`/shipments/${encodeURIComponent(shipmentId.trim())}`, {
    method: 'DELETE',
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
  /** Подстрока по базовому штрих-коду товара (products.sku), не по SKU варианта. */
  sku?: string
  /** Подстрока по названию товара (products.name). */
  name?: string
  date_from?: string
  date_to?: string
  /** Фильтр поступлений по статусу */
  receipt_status?: 'pending' | 'accepted' | ''
  /** Фильтр отгрузок по статусу */
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
  /** Подстрока по базовому штрих-коду товара */
  sku?: string
  /** Подстрока по названию товара */
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

// ——— Личный кабинет клиента (client_id только на сервере) ———

export type ClientPortalBalancesParams = {
  page?: number
  limit?: number
  product_id?: string
  type_id?: string
  color_id?: string
  size_id?: string
  sku?: string
  name?: string
  /** @deprecated используйте name */
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
  /** @deprecated используйте name */
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

// =====================================================================
// Analytics: отчёты по операциям и остаткам.
// =====================================================================

export type AnalyticsGroup = 'day' | 'week' | 'month'

export type AnalyticsPeriod = { date_from: string; date_to: string }
export type ClientPortalDashboardMetrics = {
  total_stock: number
  period_inflow: number
  period_outflow: number
  period: AnalyticsPeriod
}
export type AnalyticsFilters = {
  client_ids: string[]
  product_id: string | null
  type_id: string | null
}

export type MovementBucket = { period: string; inflow: number; outflow: number }
export type MovementReport = {
  report: 'movement'
  chart: 'line'
  explanation: string
  group: AnalyticsGroup
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  data: MovementBucket[]
}

export type StockSnapshotItem = {
  product_id: string
  product: string
  type_id: string | null
  type_name: string | null
  client_id: string | null
  client: string | null
  color_id: string | null
  color: string | null
  size_id: string | null
  size: string | null
  stock: number
}
export type StockSnapshotReport = {
  report: 'stock_snapshot'
  chart: 'table'
  explanation: string
  at_date: string
  filters: AnalyticsFilters
  data: StockSnapshotItem[]
}

export type TopProductItem = {
  product_id: string
  product: string
  type_name: string | null
  total_outflow: number
}
export type TopProductsReport = {
  report: 'top_products'
  chart: 'bar'
  explanation: string
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  limit: number
  data: TopProductItem[]
}

export type DeadStockItem = {
  product_id: string
  product: string
  client_id: string | null
  client: string | null
  color_id: string | null
  color: string | null
  size_id: string | null
  size: string | null
  stock: number
  last_movement_at: string | null
  days_without_movement: number
}
export type DeadStockReport = {
  report: 'dead_stock'
  chart: 'table'
  explanation: string
  days_threshold: number
  filters: AnalyticsFilters
  data: DeadStockItem[]
}

export type ClientActivityItem = {
  client_id: string
  client: string
  total_outflow: number
  operations: number
}
export type ClientActivityReport = {
  report: 'client_activity'
  chart: 'bar'
  explanation: string
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  data: ClientActivityItem[]
}

export type BalanceReport = {
  report: 'balance'
  chart: 'bar'
  explanation: string
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  inflow: number
  outflow: number
  delta: number
  prev_inflow: number
  prev_outflow: number
  prev_delta: number
  inflow_change_pct: number | null
  outflow_change_pct: number | null
  delta_trend: 'up' | 'down' | 'flat'
}

export type ByTypeItem = {
  type_id: string | null
  type_name: string
  stock: number
  outflow: number
  inflow: number
}
export type ByTypeReport = {
  report: 'by_type'
  chart: 'bar'
  explanation: string
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  data: ByTypeItem[]
}

export type AdminDashboardStockByClient = {
  client_id: string
  client: string
  stock: number
}

export type AdminDashboardClientMovement = {
  client_id: string
  client: string
  inflow: number
  outflow: number
}

export type AdminDashboardReport = {
  report: 'admin_dashboard'
  period: AnalyticsPeriod
  filters: AnalyticsFilters
  at_date: string
  total_inflow: number
  total_outflow: number
  stock_total: number
  active_clients: number
  movement_clients_limit: number
  stock_by_client: AdminDashboardStockByClient[]
  client_movement: AdminDashboardClientMovement[]
  explanation: string
}

export type AnalyticsCommonParams = {
  date_from?: string
  date_to?: string
  /** Несколько клиентов; пусто — все клиенты */
  client_ids?: string[]
  /** @deprecated Передаётся как один client_ids в запросе */
  client_id?: string
  product_id?: string
  type_id?: string
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

export function getAnalyticsMovement(
  params?: AnalyticsCommonParams & { group?: AnalyticsGroup },
) {
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

export function getAnalyticsTopProducts(
  params?: AnalyticsCommonParams & { limit?: number },
) {
  const sp = new URLSearchParams()
  appendCommon(sp, params)
  if (params?.limit != null) sp.set('limit', String(params.limit))
  const q = sp.toString()
  return request<TopProductsReport>(
    q ? `/analytics/top-products?${q}` : '/analytics/top-products',
  )
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

export function getAnalyticsClientActivity(
  params?: AnalyticsCommonParams & { limit?: number },
) {
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

export function getAnalyticsByType(
  params?: Omit<AnalyticsCommonParams, 'product_id' | 'type_id'>,
) {
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

export type MovementImportPreviewErrorItem = { row: number; error: string }
export type MovementImportPreviewWarningItem = { row: number; warning: string }
export type MovementImportPreviewRowResult = {
  excel_row: number
  date: string
  barcode: string
  color: string
  size?: string | null
  quantity: number | null
  status_display: string
  found_product_name?: string | null
  errors: string[]
  warnings: string[]
}
export type MovementImportPreviewRow = {
  excel_row: number
  date: string
  name: string
  barcode: string
  color: string
  size?: string | null
  quantity: number
  status: string
  receipt_status?: string | null
  shipment_status?: string | null
  comment?: string | null
  product_name: string
  client_name?: string | null
  preview_image_url?: string | null
  warnings: string[]
}

export type MovementImportPreviewResponse = {
  summary_total: number
  summary_ok: number
  summary_with_errors: number
  import_ready: boolean
  file_status_label: string
  row_results: MovementImportPreviewRowResult[]
  valid_rows: MovementImportPreviewRow[]
  errors: MovementImportPreviewErrorItem[]
  warnings: MovementImportPreviewWarningItem[]
}

export type MovementImportCommitResponse = {
  total: number
  success: number
  failed: number
  warnings: number
}

export type ImportExcelUploadResponse = {
  file_id: string
  file_name: string
  file_size: number
}

const IMPORT_TEMPLATE_DOWNLOAD_NAME: Record<InventoryOpType, string> = {
  in: 'Поступление.xlsx',
  out: 'Отгрузка.xlsx',
}

export function postImportExcelUploadWithProgress(
  params: { templateType: 'receipt' | 'shipment'; file: File },
  onProgress: (percent: number) => void,
): Promise<ImportExcelUploadResponse> {
  const token = getToken()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL}/import/upload`)
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    xhr.responseType = 'json'
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        onProgress(Math.min(100, Math.round((100 * ev.loaded) / Math.max(ev.total, 1))))
      }
    }
    xhr.onerror = () => reject(new Error('Ошибка сети при загрузке файла'))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ImportExcelUploadResponse)
        return
      }
      const body = xhr.response
      reject(new Error(formatApiErrorDetail(body, xhr.status)))
    }
    const form = new FormData()
    form.append('template_type', params.templateType)
    form.append('file', params.file)
    xhr.send(form)
  })
}

export async function deleteImportStaging(fileId: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}/import/staging/${encodeURIComponent(fileId.trim())}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, res.status))
  }
}

export function postMovementsImportPreviewStaged(opType: InventoryOpType, fileId: string) {
  const q = `op_type=${encodeURIComponent(opType)}&file_id=${encodeURIComponent(fileId.trim())}`
  const form = new FormData()
  return requestForm<MovementImportPreviewResponse>(`/import/movements/preview-staged?${q}`, {
    method: 'POST',
    body: form,
  })
}

export function postMovementsImportCommitStaged(
  opType: InventoryOpType,
  fileId: string,
  partial: boolean,
) {
  const p = partial ? '1' : '0'
  const q = `op_type=${encodeURIComponent(opType)}&file_id=${encodeURIComponent(fileId.trim())}&partial=${p}`
  const form = new FormData()
  return requestForm<MovementImportCommitResponse>(`/import/movements/commit-staged?${q}`, {
    method: 'POST',
    body: form,
  })
}

export function postMovementsImportPreview(opType: InventoryOpType, file: File) {
  const form = new FormData()
  form.append('file', file)
  return requestForm<MovementImportPreviewResponse>(
    `/import/movements/preview?op_type=${encodeURIComponent(opType)}`,
    { method: 'POST', body: form },
  )
}

export function postMovementsImportCommit(opType: InventoryOpType, file: File, partial: boolean) {
  const form = new FormData()
  form.append('file', file)
  const p = partial ? '1' : '0'
  return requestForm<MovementImportCommitResponse>(
    `/import/movements/commit?op_type=${encodeURIComponent(opType)}&partial=${p}`,
    { method: 'POST', body: form },
  )
}

export async function downloadMovementsImportTemplate(opType: InventoryOpType) {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(
    `${API_BASE_URL}/import/movements/template?op_type=${encodeURIComponent(opType)}`,
    { headers },
  )
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, r.status))
  }
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = IMPORT_TEMPLATE_DOWNLOAD_NAME[opType]
  a.click()
  URL.revokeObjectURL(url)
}
