import { SessionExpiredError } from '../auth/sessionError'
import { API_BASE_URL, AUTH_FETCH_CREDENTIALS } from './constants'
import { invalidateSessionAfterUnauthorizedApi } from './sessionInvalidate'
import { getToken } from './tokenStore'

const AUTH_PATHS_NO_SESSION_INVALIDATION_ON_401 = new Set(['/auth/login', '/auth/register'])

export type RequestOptions = RequestInit & {
  /** Не реагировать на 401 (используется для logout — сессия и так сбрасывается). */
  skipUnauthorizedHandler?: boolean
  /**
   * Защита от дублей при обрыве сети. По умолчанию ВКЛЮЧЕНА для write-методов
   * (POST/PUT/PATCH/DELETE) — создание документов и команды. Две линии обороны:
   *  1) single-flight — одновременные одинаковые запросы (повторные клики, пока
   *     первый «висит») схлопываются в один fetch;
   *  2) стабильный `X-Request-Id` — если идентичный запрос только что оборвался,
   *     повтор уходит с тем же ключом, и бэкенд (idempotency_keys) не выполняет
   *     операцию повторно (двойной документ / двойная оплата), даже если первый
   *     запрос на самом деле дошёл.
   *
   * Передать `false`, чтобы выключить для конкретного запроса.
   */
  idempotent?: boolean
}

/** UUID для идемпотентности write-операций (X-Request-Id). */
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `rid-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isWriteRequest(init: RequestOptions | undefined): boolean {
  return WRITE_METHODS.has((init?.method ?? 'GET').toUpperCase())
}

// Глобальный индикатор активности (прелоадер): счётчик незавершённых write-запросов.
// Полоса прогресса вверху подписывается через subscribeApiBusy и показывается, пока
// счётчик > 0 — обратная связь пользователю при подвисании сети.
let activeWriteCount = 0
const busyListeners = new Set<() => void>()

function notifyBusy(): void {
  for (const listener of busyListeners) listener()
}

function changeBusy(delta: number): void {
  activeWriteCount = Math.max(0, activeWriteCount + delta)
  notifyBusy()
}

export function getApiBusy(): boolean {
  return activeWriteCount > 0
}

export function subscribeApiBusy(listener: () => void): () => void {
  busyListeners.add(listener)
  return () => {
    busyListeners.delete(listener)
  }
}

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

async function doFetch(
  path: string,
  init: RequestOptions | undefined,
  headers: Record<string, string>,
): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: init?.credentials ?? AUTH_FETCH_CREDENTIALS,
      headers,
    })
  } catch (error) {
    if (error instanceof TypeError) {
      const msg = import.meta.env.DEV
        ? 'Сервер API недоступен. Запустите бэкенд: в папке backend выполните python -m uvicorn app:app --host 127.0.0.1 --port 8000'
        : 'Сервер недоступен. Проверьте подключение и повторите попытку.'
      throw new Error(msg, { cause: error })
    }
    throw error
  }
}

function buildAuthHeaders(path: string, init: RequestOptions | undefined, contentTypeJson: boolean): Record<string, string> {
  const headers: Record<string, string> = {}
  if (contentTypeJson) headers['Content-Type'] = 'application/json'
  if (init?.headers) {
    Object.assign(headers, init.headers as Record<string, string>)
  }
  const token = getToken()
  if (token) {
    const pathKey = apiPathWithoutQuery(path)
    const publicAuth = pathKey === '/auth/login' || pathKey === '/auth/register'
    if (!publicAuth) {
      headers.Authorization = `Bearer ${token}`
    }
  }
  return headers
}

async function executeRequest<T>(path: string, init?: RequestOptions): Promise<T> {
  const headers = buildAuthHeaders(path, init, true)
  const response = await doFetch(path, init, headers)
  if (!init?.skipUnauthorizedHandler) {
    throwIfUnauthorizedApi(path, response, headers)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }
  return response.json() as Promise<T>
}

// Дедупликация идемпотентных write-запросов. Ключ = метод + путь + тело: одинаковая
// форма создаёт одинаковый ключ. Окно — сколько держим id оборвавшегося запроса для
// переиспользования на ретрае (после него повтор считается новым документом).
const IDEMPOTENCY_WINDOW_MS = 60_000

type IdempotencyEntry = {
  requestId: string
  /** Промис незавершённого запроса — к нему присоединяются параллельные клики. */
  promise?: Promise<unknown>
  /** Когда идентичный запрос оборвался; в пределах окна повтор переиспользует id. */
  failedAt?: number
}

const idempotencyEntries = new Map<string, IdempotencyEntry>()

function idempotencyKey(path: string, init: RequestOptions): string {
  const method = (init.method ?? 'GET').toUpperCase()
  const body = typeof init.body === 'string' ? init.body : ''
  return `${method} ${path} ${body}`
}

function pruneIdempotencyEntries(now: number): void {
  for (const [key, entry] of idempotencyEntries) {
    if (!entry.promise && entry.failedAt != null && now - entry.failedAt >= IDEMPOTENCY_WINDOW_MS) {
      idempotencyEntries.delete(key)
    }
  }
}

async function idempotentRequest<T>(path: string, init: RequestOptions): Promise<T> {
  const now = Date.now()
  pruneIdempotencyEntries(now)

  const key = idempotencyKey(path, init)
  const existing = idempotencyEntries.get(key)

  // Запрос с такой же формой уже летит — присоединяемся, второго fetch не делаем.
  if (existing?.promise) {
    return existing.promise as Promise<T>
  }

  // Недавний идентичный запрос оборвался → ретрай с тем же X-Request-Id (бэкенд не задвоит).
  const reuse = existing?.failedAt != null && now - existing.failedAt < IDEMPOTENCY_WINDOW_MS
  const requestId = reuse && existing ? existing.requestId : newRequestId()

  const headers = { ...(init.headers as Record<string, string> | undefined), 'X-Request-Id': requestId }
  changeBusy(1)
  const promise = executeRequest<T>(path, { ...init, headers }).finally(() => changeBusy(-1))
  idempotencyEntries.set(key, { requestId, promise })

  try {
    const result = await promise
    // Успех — забываем ключ: следующий идентичный запрос создаст новый документ.
    idempotencyEntries.delete(key)
    return result
  } catch (err) {
    // Ошибка (в т.ч. обрыв сети) — держим id в окне ретрая для переиспользования.
    idempotencyEntries.set(key, { requestId, failedAt: Date.now() })
    throw err
  }
}

export function request<T>(path: string, init?: RequestOptions): Promise<T> {
  // Идемпотентность по умолчанию для write-методов; явный idempotent имеет приоритет.
  const idempotent = init?.idempotent ?? isWriteRequest(init)
  if (idempotent) return idempotentRequest<T>(path, init as RequestOptions)
  return executeRequest<T>(path, init)
}

export async function requestForm<T>(path: string, init?: RequestOptions): Promise<T> {
  const headers = buildAuthHeaders(path, init, false)
  const response = await doFetch(path, init, headers)
  if (!init?.skipUnauthorizedHandler) {
    throwIfUnauthorizedApi(path, response, headers)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(formatApiErrorDetail(body, response.status))
  }
  return response.json() as Promise<T>
}
