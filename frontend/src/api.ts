const API_BASE_URL = 'http://127.0.0.1:8000'

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

export type ProductItem = {
  id: string
  name: string
  type: 'одежда' | 'техника'
  sku: string
  supplier: string | null
  image_url: string | null
  is_active: boolean
  created_at: string
  creator: string | null
  updated_at: string | null
  editor: string | null
}

function getToken() {
  return localStorage.getItem('token')
}

export function saveToken(token: string) {
  localStorage.setItem('token', token)
}

export function clearToken() {
  localStorage.removeItem('token')
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
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })

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
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })
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

export function me() {
  return request<User>('/auth/me')
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

export function getDictionary(kind: 'clients' | 'colors' | 'sizes') {
  return request<DictionaryItem[]>(`/${kind}`)
}

export function getDictionaryItem(kind: 'clients' | 'colors' | 'sizes', id: string) {
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

export function getProducts() {
  return request<ProductItem[]>('/products')
}

export function getProduct(id: string) {
  return request<ProductItem>(`/products/${id}`)
}

export function createProduct(payload: {
  name: string
  type: 'одежда' | 'техника'
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
    type?: 'одежда' | 'техника'
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
