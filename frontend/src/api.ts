export const API_BASE_URL = 'http://127.0.0.1:8000'

export type User = {
  id: string
  email: string
  role: 'user' | 'manager' | 'admin'
}

type AuthResponse = {
  token: string
}

export type UserListItem = {
  id: string
  email: string
  role: 'user' | 'manager' | 'admin'
  created_at: string
}

export type DictionaryItem = {
  id: string
  name: string
  is_active: boolean
  created_at: string
  creator: string | null
  updated_at: string | null
  editor: string | null
}

/** ТЗ: enum одежда/техника; в API: clothes / tech */
export const PRODUCT_TYPE_LABELS = {
  clothes: 'Одежда',
  tech: 'Техника',
} as const

export type ProductType = keyof typeof PRODUCT_TYPE_LABELS

export type ProductItem = {
  id: string
  name: string
  type: ProductType
  sku: string
  supplier: string | null
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

export function updateUserRole(userId: string, role: 'user' | 'manager') {
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
  is_active?: boolean
  sort?: string
}

/** Список клиентов с пагинацией (GET /clients) */
export function getClients(params?: DictionaryListQueryParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.search != null && params.search.trim() !== '') sp.set('search', params.search.trim())
  if (params?.is_active === true || params?.is_active === false) {
    sp.set('is_active', String(params.is_active))
  }
  if (params?.sort != null && params.sort.trim() !== '') sp.set('sort', params.sort.trim())
  const q = sp.toString()
  return request<DictionaryListResponse>(q ? `/clients?${q}` : '/clients')
}

export function getDictionary(kind: 'colors' | 'sizes') {
  return request<DictionaryItem[]>(`/${kind}`)
}

export function getDictionaryItem(
  kind: 'clients' | 'colors' | 'sizes',
  id: string,
) {
  return request<DictionaryItem>(`/${kind}/${id}`)
}

export function createDictionaryItem(
  kind: 'clients' | 'colors' | 'sizes',
  payload: { name: string; is_active: boolean },
) {
  return request<{ message: string }>(`/${kind}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateDictionaryItem(
  kind: 'clients' | 'colors' | 'sizes',
  id: string,
  payload: { name?: string; is_active?: boolean },
) {
  return request<{ message: string }>(`/${kind}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function deleteDictionaryItem(kind: 'clients' | 'colors' | 'sizes', id: string) {
  return request<{ message: string }>(`/${kind}/${id}`, {
    method: 'DELETE',
  })
}

export type ProductListQueryParams = {
  page?: number
  limit?: number
  search?: string
  sku?: string
  supplier?: string
  type?: ProductType
  is_active?: boolean
  sort?: string
}

export function getProducts(params?: ProductListQueryParams) {
  const sp = new URLSearchParams()
  if (params?.page != null) sp.set('page', String(params.page))
  if (params?.limit != null) sp.set('limit', String(params.limit))
  if (params?.search != null && params.search.trim() !== '') sp.set('search', params.search.trim())
  if (params?.sku != null && params.sku.trim() !== '') sp.set('sku', params.sku.trim())
  if (params?.supplier != null && params.supplier.trim() !== '') {
    sp.set('supplier', params.supplier.trim())
  }
  if (params?.type === 'clothes' || params?.type === 'tech') sp.set('type', params.type)
  if (params?.is_active === true || params?.is_active === false) {
    sp.set('is_active', String(params.is_active))
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
  type: ProductType
  sku: string
  supplier: string
  is_active: boolean
  image?: File | null
}) {
  const form = new FormData()
  form.append('name', payload.name)
  form.append('type', payload.type)
  form.append('sku', payload.sku)
  form.append('supplier', payload.supplier)
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
    type?: ProductType
    sku?: string
    supplier?: string
    is_active?: boolean
    image?: File | null
  },
) {
  const form = new FormData()
  if (payload.name !== undefined) form.append('name', payload.name)
  if (payload.type !== undefined) form.append('type', payload.type)
  if (payload.sku !== undefined) form.append('sku', payload.sku)
  if (payload.supplier !== undefined) form.append('supplier', payload.supplier)
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
