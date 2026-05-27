import { broadcastAuthLogout } from '../auth/tabSync'
import { API_BASE_URL, AUTH_FETCH_CREDENTIALS } from './constants'
import { formatApiErrorDetail, request } from './http'
import {
  clearProfileCache,
  meCacheTtlMs,
  readMeCache,
  readMeInFlight,
  writeMeCache,
  writeMeInFlight,
} from './profileCache'
import { getToken, setAccessTokenMemory } from './tokenStore'
import type { User } from './typesUser'

export type { User } from './typesUser'

type AuthResponse = {
  access_token: string
  token_type: string
  expires_in: number
}

let refreshAccessTokenPromise: Promise<string | null> | null = null

export function saveToken(token: string): void {
  setAccessTokenMemory(token)
  clearProfileCache()
}

export function clearToken(): void {
  setAccessTokenMemory(null)
  clearProfileCache()
}

async function fetchAccessTokenViaRefreshOnce(): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: AUTH_FETCH_CREDENTIALS,
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: controller.signal,
  }).finally(() => clearTimeout(timer))
  if (res.status === 401) {
    return null
  }
  if (!res.ok) {
    throw new Error(`refresh ${res.status}`)
  }
  const data = (await res.json()) as AuthResponse
  saveToken(data.access_token)
  return data.access_token
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshAccessTokenPromise) {
    refreshAccessTokenPromise = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await fetchAccessTokenViaRefreshOnce()
        } catch {
          if (attempt === 2) {
            return null
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
        }
      }
      return null
    })().finally(() => {
      refreshAccessTokenPromise = null
    })
  }
  return refreshAccessTokenPromise
}

export async function ensureSessionBootstrapped(): Promise<boolean> {
  if (getToken()) {
    return true
  }
  const t = await refreshAccessToken()
  return t != null && getToken() != null
}

export async function authLogout(): Promise<void> {
  const token = getToken()
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: AUTH_FETCH_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: '{}',
    })
  } catch {
    // Logout is best-effort; local session cleanup still runs below.
  } finally {
    clearToken()
    broadcastAuthLogout()
  }
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
  const cached = readMeCache()
  if (cached && cached.token === token && Date.now() < cached.expires) {
    return Promise.resolve(cached.user)
  }
  const inflight = readMeInFlight()
  if (inflight) {
    return inflight
  }
  const p = request<User>('/auth/me')
    .then((user) => {
      const t = getToken()
      if (t) {
        writeMeCache({ user, token: t, expires: Date.now() + meCacheTtlMs() })
      }
      return user
    })
    .catch((e) => {
      clearProfileCache()
      throw e
    })
    .finally(() => {
      writeMeInFlight(null)
    })
  writeMeInFlight(p)
  return p
}

export async function fetchSystemVersion(): Promise<{ version: string; environment: string }> {
  const response = await fetch(`${API_BASE_URL}/version`, {
    method: 'GET',
    credentials: AUTH_FETCH_CREDENTIALS,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }
  return response.json() as Promise<{ version: string; environment: string }>
}

export { clearProfileCache } from './profileCache'
export { getToken } from './tokenStore'
