import { API_BASE_URL, AUTH_FETCH_CREDENTIALS, IS_NATIVE } from './constants'
import { applyAuthTokens, clearTokens, getRefresh, getToken } from './tokenStore'

const PUBLIC_AUTH_PATHS = new Set(['/auth/login', '/auth/register', '/auth/refresh'])

export class SessionExpiredError extends Error {
  constructor() {
    super('Сессия истекла')
    this.name = 'SessionExpiredError'
  }
}

// Когда refresh окончательно не удался (истёкшая/отозванная сессия), приложение
// должно вернуть пользователя на экран входа. AuthContext регистрирует здесь
// колбэк; http.ts дёргает его перед тем, как бросить SessionExpiredError.
let onSessionExpired: (() => void) | null = null
export function setSessionExpiredHandler(fn: (() => void) | null): void {
  onSessionExpired = fn
}

type RequestOptions = RequestInit & {
  /** Не пытаться обновить сессию на 401 (для самого refresh / logout). */
  skipRefresh?: boolean
}

function apiPathWithoutQuery(path: string): string {
  const q = path.indexOf('?')
  return q === -1 ? path : path.slice(0, q)
}

/** UUID для идемпотентности write-операций (X-Request-Id, см. docs/mobile-plan.md §6.3). */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `rid-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

/** Заголовок идемпотентности для write-запроса (пусто, если id не задан). */
export function requestIdHeaders(requestId?: string): Record<string, string> {
  return requestId ? { 'X-Request-Id': requestId } : {}
}

/** Разбор тела ошибки FastAPI (detail строка / массив validation / объект) в одну строку. */
export function formatApiErrorDetail(body: unknown, httpStatus: number): string {
  const fallback =
    httpStatus > 0
      ? `Запрос не выполнен (код ${httpStatus}). Повторите попытку или обратитесь к администратору.`
      : 'Не удалось выполнить запрос. Повторите попытку.'
  if (body == null) return fallback
  if (typeof body === 'string') return body.trim() || fallback
  if (typeof body !== 'object') return fallback
  const o = body as Record<string, unknown>
  const detail = o.detail
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item.trim()
        if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>
          const msg =
            typeof rec.msg === 'string' ? rec.msg.trim() : typeof rec.message === 'string' ? rec.message.trim() : ''
          if (!msg) return ''
          // loc-префикс валидации FastAPI («body.email») → имя поля в тексте ошибки.
          const locRaw = rec.loc
          const loc =
            Array.isArray(locRaw) && locRaw.length
              ? locRaw.filter((x) => x !== 'body').map((x) => String(x)).join('.')
              : ''
          return loc ? `${loc}: ${msg}` : msg
        }
        return ''
      })
      .filter(Boolean)
    if (parts.length) return parts.join(' ')
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const rec = detail as Record<string, unknown>
    if (typeof rec.msg === 'string' && rec.msg.trim()) return rec.msg.trim()
    if (typeof rec.message === 'string' && rec.message.trim()) return rec.message.trim()
  }
  if (typeof o.message === 'string' && o.message.trim()) return o.message.trim()
  return fallback
}

function buildHeaders(path: string, init: RequestOptions | undefined, json: boolean): Record<string, string> {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  if (IS_NATIVE) headers['X-Client'] = 'mobile'
  if (init?.headers) Object.assign(headers, init.headers as Record<string, string>)
  const token = getToken()
  if (token && !PUBLIC_AUTH_PATHS.has(apiPathWithoutQuery(path))) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

const NETWORK_ERROR = 'Сервер недоступен. Проверьте подключение и повторите попытку.'

async function doFetch(path: string, init: RequestOptions | undefined, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: init?.credentials ?? AUTH_FETCH_CREDENTIALS,
      headers,
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(NETWORK_ERROR, { cause: error })
    }
    throw error
  }
}

// Чтение тела ответа может оборваться на мобильной сети уже ПОСЛЕ получения
// заголовков (блип соединения во время стрима тела). fetch.json() бросает тогда
// «TypeError: Failed to fetch» — без этой обёртки сырой текст всплывал в UI.
async function readJsonBody<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(NETWORK_ERROR, { cause: error })
    }
    throw error
  }
}

/** Одна попытка обновить access-токен: refresh-cookie (браузер) или refresh из памяти (натив). */
async function tryRefreshSession(): Promise<boolean> {
  try {
    const init: RequestOptions = { method: 'POST', skipRefresh: true }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (IS_NATIVE) {
      const rt = getRefresh()
      if (!rt) return false
      headers['X-Client'] = 'mobile'
      init.body = JSON.stringify({ refresh_token: rt })
    }
    const res = await doFetch('/auth/refresh', init, headers)
    if (!res.ok) return false
    const data = (await res.json()) as { access_token?: string; refresh_token?: string | null }
    if (!data.access_token) return false
    await applyAuthTokens({ access_token: data.access_token, refresh_token: data.refresh_token })
    return true
  } catch {
    return false
  }
}

export async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  let headers = buildHeaders(path, init, true)
  let response = await doFetch(path, init, headers)

  // 401 с Bearer и не на публичном auth-пути → одна попытка refresh + повтор.
  const hadBearer = typeof headers.Authorization === 'string'
  if (response.status === 401 && hadBearer && !init?.skipRefresh) {
    const refreshed = await tryRefreshSession()
    if (refreshed) {
      headers = buildHeaders(path, init, true)
      response = await doFetch(path, init, headers)
    }
    if (response.status === 401) {
      await clearTokens()
      onSessionExpired?.()
      throw new SessionExpiredError()
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }
  if (response.status === 204) return undefined as T
  return readJsonBody<T>(response)
}

/** Как request, но тело — FormData (multipart): Content-Type не задаём, его ставит браузер с boundary. */
export async function requestForm<T>(path: string, init: RequestOptions): Promise<T> {
  let headers = buildHeaders(path, init, false)
  let response = await doFetch(path, init, headers)

  const hadBearer = typeof headers.Authorization === 'string'
  if (response.status === 401 && hadBearer && !init.skipRefresh) {
    const refreshed = await tryRefreshSession()
    if (refreshed) {
      headers = buildHeaders(path, init, false)
      response = await doFetch(path, init, headers)
    }
    if (response.status === 401) {
      await clearTokens()
      onSessionExpired?.()
      throw new SessionExpiredError()
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }
  if (response.status === 204) return undefined as T
  return readJsonBody<T>(response)
}
