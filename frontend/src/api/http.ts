import { SessionExpiredError } from '../auth/sessionError'
import { API_BASE_URL, AUTH_FETCH_CREDENTIALS } from './constants'
import { invalidateSessionAfterUnauthorizedApi } from './sessionInvalidate'
import { getToken } from './tokenStore'

const AUTH_PATHS_NO_SESSION_INVALIDATION_ON_401 = new Set(['/auth/login', '/auth/register'])

function headerHasBearerAuthorization(headers: Record<string, string>): boolean {
  const a = headers.Authorization
  return typeof a === 'string' && a.startsWith('Bearer ')
}

function apiPathWithoutQuery(path: string): string {
  const q = path.indexOf('?')
  return q === -1 ? path : path.slice(0, q)
}

/**
 * Централизованная реакция на 401: только если запрос ушёл с Bearer (иначе это, например, неверный пароль на /auth/login).
 */
export function throwIfUnauthorizedApi(
  path: string,
  response: Response,
  headers: Record<string, string>,
): void {
  if (response.status !== 401) return
  if (!headerHasBearerAuthorization(headers)) return
  const key = apiPathWithoutQuery(path)
  if (AUTH_PATHS_NO_SESSION_INVALIDATION_ON_401.has(key)) return
  invalidateSessionAfterUnauthorizedApi()
  throw new SessionExpiredError()
}

/** Разбирает JSON-тело ошибки FastAPI/Starlette (detail строка, массив validation errors и т.д.). */
export function formatApiErrorDetail(body: unknown, httpStatus: number): string {
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

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (init?.headers) {
    Object.assign(headers, init.headers as Record<string, string>)
  }

  if (token) {
    const pathKey = apiPathWithoutQuery(path)
    const publicAuth = pathKey === '/auth/login' || pathKey === '/auth/register'
    if (!publicAuth) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: init?.credentials ?? AUTH_FETCH_CREDENTIALS,
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

  throwIfUnauthorizedApi(path, response, headers)

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }

  return response.json() as Promise<T>
}

export async function requestForm<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (init?.headers) {
    Object.assign(headers, init.headers as Record<string, string>)
  }
  if (token) {
    const pathKey = apiPathWithoutQuery(path)
    const publicAuth = pathKey === '/auth/login' || pathKey === '/auth/register'
    if (!publicAuth) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: init?.credentials ?? AUTH_FETCH_CREDENTIALS,
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
  throwIfUnauthorizedApi(path, response, headers)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }
  return response.json() as Promise<T>
}
