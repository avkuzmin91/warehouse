export const API_BASE_URL = 'http://127.0.0.1:8000'

/** ID «Актуален» в системном справочнике актуальности (совпадает с backend `RECORD_ACTUALITY_YES_ID`). */
export const RECORD_ACTUALITY_YES_ID = '00000000-0000-4000-8000-000000000001'

export type User = {
  id: string
  email: string
  role: 'user' | 'manager' | 'admin' | 'client'
}

type AuthResponse = {
  token: string
}

export type UserListItem = {
  id: string
  email: string
  role: 'user' | 'manager' | 'admin' | 'client'
  created_at: string
}

export type DictionaryItem = {
  id: string
  name: string
  is_active: boolean
  created_at: string
  created_by: string | null
  updated_at: string | null
  updated_by: string | null
}

export type SizeItem = {
  id: string
  name: string
  is_active: boolean
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

export type ProductItem = {
  id: string
  name: string
  type_id: string
  type_name: string | null
  sku: string
  client_id: string | null
  client_name: string | null
  supplier_id: string | null
  supplier_name: string | null
  image_url: string | null
  /** Product: true = товар актуален, false = не актуален; по умолчанию true */
  is_active: boolean
  created_at: string
  /** Email пользователя-создателя (ТЗ: created_by) */
  created_by: string | null
  updated_at: string | null
  /** Email последнего редактора (ТЗ: updated_by) */
  updated_by: string | null
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
    const body = await response.json().catch(() => ({}))
    const detail = typeof body?.detail === 'string' ? body.detail : 'Ошибка запроса'
    throw new Error(detail)
  }

  return response.json() as Promise<T>
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
    const body = await response.json().catch(() => ({}))
    const detail = typeof body?.detail === 'string' ? body.detail : 'Ошибка запроса'
    throw new Error(detail)
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

export function deleteUser(userId: string) {
  return request<{ message: string }>(`/users/${userId}`, {
    method: 'DELETE',
  })
}

export type DictionaryListResponse = {
  items: DictionaryItem[]
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
  sku?: string
  type_id?: string
  client_id?: string
  supplier_id?: string
  actuality_id?: string
  sort?: string
  date_from?: string
  date_to?: string
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
  if (params?.supplier_id != null && params.supplier_id.trim() !== '') {
    sp.set('supplier_id', params.supplier_id.trim())
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
  return request<ProductListResponse>(q ? `/products?${q}` : '/products')
}

export function getProduct(id: string) {
  return request<ProductItem>(`/products/${id}`)
}

export function createProduct(payload: {
  name: string
  type_id: string
  sku: string
  client_id: string
  supplier_id?: string | null
  is_active: boolean
  image?: File | null
}) {
  const form = new FormData()
  form.append('name', payload.name)
  form.append('type_id', payload.type_id)
  form.append('sku', payload.sku)
  form.append('client_id', String(payload.client_id).trim())
  if (payload.supplier_id != null && String(payload.supplier_id).trim() !== '') {
    form.append('supplier_id', String(payload.supplier_id).trim())
  }
  form.append('is_active', String(payload.is_active))
  if (payload.image) {
    form.append('image', payload.image)
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
    sku?: string
    client_id?: string | null
    supplier_id?: string | null
    is_active?: boolean
    image?: File | null
  },
) {
  const form = new FormData()
  if (payload.name !== undefined) form.append('name', payload.name)
  if (payload.type_id !== undefined) form.append('type_id', payload.type_id)
  if (payload.sku !== undefined) form.append('sku', payload.sku)
  if (payload.client_id !== undefined) {
    form.append('client_id', payload.client_id != null ? String(payload.client_id).trim() : '')
  }
  if (payload.supplier_id !== undefined) {
    form.append('supplier_id', payload.supplier_id != null ? String(payload.supplier_id).trim() : '')
  }
  if (payload.is_active !== undefined) form.append('is_active', String(payload.is_active))
  if (payload.image) form.append('image', payload.image)

  return requestForm<{ message: string }>(`/products/${id}`, {
    method: 'PATCH',
    body: form,
  })
}

export function deleteProduct(id: string) {
  return request<{ message: string }>(`/products/${id}`, {
    method: 'DELETE',
  })
}
