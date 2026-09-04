import { IS_NATIVE } from './constants'
import { request } from './http'
import { loadStoredRefresh } from './secureStore'
import { applyAuthTokens, clearTokens, getRefresh, setRefresh } from './tokenStore'

// --- Types ---
export type AuthTokenResponse = {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string | null
}
export type Me = { id: string; email: string; role: string; client_id: string | null }

// Роли, имеющие складскую очередь задач (см. backend/modules/tasks/service.py).
export const WAREHOUSE_ROLES = new Set(['warehouse_manager', 'warehouse_head', 'shift_supervisor', 'picker', 'admin'])

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  warehouse_manager: 'Кладовщик',
  shift_supervisor: 'Начальник смены',
  warehouse_head: 'Начальник склада',
  picker: 'Сборщик',
  user: 'Пользователь',
}

// --- API functions ---
export async function login(email: string, password: string): Promise<Me> {
  const res = await request<AuthTokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    skipRefresh: true,
  })
  await applyAuthTokens(res)
  return me()
}

export function me(): Promise<Me> {
  return request<Me>('/auth/me')
}

/** Восстановление сессии при старте: refresh → /auth/me. null, если нет сессии.
 *  Веб берёт refresh из cookie; натив — из secure storage. */
export async function bootstrapSession(): Promise<Me | null> {
  try {
    if (IS_NATIVE) {
      const stored = await loadStoredRefresh()
      if (!stored) return null
      setRefresh(stored)
    }
    const res = await request<AuthTokenResponse>('/auth/refresh', {
      method: 'POST',
      skipRefresh: true,
      body: IS_NATIVE ? JSON.stringify({ refresh_token: getRefresh() }) : undefined,
    })
    await applyAuthTokens(res)
    return await me()
  } catch {
    await clearTokens()
    return null
  }
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/auth/logout', {
      method: 'POST',
      skipRefresh: true,
      body: IS_NATIVE ? JSON.stringify({ refresh_token: getRefresh() }) : undefined,
    })
  } catch {
    // logout идемпотентен — игнорируем сетевые ошибки
  }
  await clearTokens()
}
