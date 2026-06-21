// Access-токен (JWT, TTL 60 мин) держим только в памяти процесса.
// Refresh: на вебе — в HttpOnly cookie (браузер), в нативе — в secure storage
// (см. secureStore.ts), а в памяти держим текущий для ротации. Никакого
// localStorage для токенов.
import { IS_NATIVE } from './constants'
import { clearStoredRefresh, saveStoredRefresh } from './secureStore'

let accessToken: string | null = null
let refreshToken: string | null = null

export function getToken(): string | null {
  return accessToken
}

export function setToken(token: string | null): void {
  accessToken = token
}

export function clearToken(): void {
  accessToken = null
}

export function getRefresh(): string | null {
  return refreshToken
}

export function setRefresh(token: string | null): void {
  refreshToken = token
}

type TokenResponse = { access_token: string; refresh_token?: string | null }

/** Применить ответ /auth/login|/auth/refresh: access в память, refresh (натив) в память + secure storage. */
export async function applyAuthTokens(res: TokenResponse): Promise<void> {
  accessToken = res.access_token
  if (IS_NATIVE && res.refresh_token) {
    refreshToken = res.refresh_token
    await saveStoredRefresh(res.refresh_token)
  }
}

/** Полный сброс сессии (выход / истёкший refresh): память + persisted refresh. */
export async function clearTokens(): Promise<void> {
  accessToken = null
  refreshToken = null
  await clearStoredRefresh()
}
