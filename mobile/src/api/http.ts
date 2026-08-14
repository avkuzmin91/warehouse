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
  /**
   * Защита от дублей при обрыве сети. По умолчанию ВКЛЮЧЕНА для write-методов
   * (POST/PUT/PATCH/DELETE) — создание документов и команды. Две линии обороны:
   *  1) single-flight — одновременные одинаковые запросы (повторные тапы, пока
   *     первый «висит») схлопываются в один fetch;
   *  2) стабильный `X-Request-Id` — если идентичный запрос только что оборвался,
   *     повтор уходит с тем же ключом, и бэкенд (idempotency_keys) не выполняет
   *     операцию повторно (двойной документ / двойная оплата), даже если первый
   *     запрос на самом деле дошёл.
   *
   * Явно переданный заголовок `X-Request-Id` имеет приоритет над автоматическим.
   * Передать `false`, чтобы выключить для конкретного запроса.
   */
  idempotent?: boolean
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isWriteRequest(init: RequestOptions | undefined): boolean {
  return WRITE_METHODS.has((init?.method ?? 'GET').toUpperCase())
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

// Глобальное состояние «сеть лежит»: выставляется по сетевому фейлу fetch,
// сбрасывается первым успешным ответом (или событием browser online). Смена
// состояния рассылается событием — на него подписаны OfflineBanner и экраны,
// которым нужно перезагрузить данные после восстановления связи.
export const CONNECTIVITY_EVENT = 'wms:connectivity'

let networkDown = false

export function isNetworkDown(): boolean {
  return networkDown
}

function setNetworkDown(down: boolean): void {
  if (networkDown === down) return
  networkDown = down
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONNECTIVITY_EVENT, { detail: { online: !down } }))
  }
}

// Браузерное «online» — оптимистичный сброс: реальную доступность подтвердит
// первый же запрос, но баннер не должен висеть до него.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setNetworkDown(false))
}

async function doFetch(path: string, init: RequestOptions | undefined, headers: Record<string, string>): Promise<Response> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: init?.credentials ?? AUTH_FETCH_CREDENTIALS,
      headers,
    })
    setNetworkDown(false)
    return response
  } catch (error) {
    if (error instanceof TypeError) {
      setNetworkDown(true)
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

// Несколько параллельных запросов могут получить 401 одновременно (типично при
// старте экрана). Без дедупликации каждый запустил бы свой POST /auth/refresh, а на
// нативе с ротацией refresh-токена параллельные обновления взаимно инвалидируют друг
// друга (один выигрывает, остальные получают уже отозванный токен → разлогин среди
// работы). Поэтому держим один общий in-flight промис: первый 401 запускает refresh,
// остальные ждут его результат.
let refreshInFlight: Promise<boolean> | null = null

function refreshSessionOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = tryRefreshSession().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
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

async function executeRequest<T>(path: string, init?: RequestOptions): Promise<T> {
  let headers = buildHeaders(path, init, true)
  let response = await doFetch(path, init, headers)

  // 401 с Bearer и не на публичном auth-пути → одна попытка refresh + повтор.
  const hadBearer = typeof headers.Authorization === 'string'
  if (response.status === 401 && hadBearer && !init?.skipRefresh) {
    const refreshed = await refreshSessionOnce()
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

// Дедупликация идемпотентных write-запросов (перенос web-реализации из
// frontend/src/api/http.ts). Ключ = метод + путь + тело: одинаковая форма создаёт
// одинаковый ключ. Окно — сколько держим id оборвавшегося запроса для
// переиспользования на ретрае (после него повтор считается новым документом).
const IDEMPOTENCY_WINDOW_MS = 60_000

type IdempotencyEntry = {
  requestId: string
  /** Промис незавершённого запроса — к нему присоединяются параллельные тапы. */
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

/** Явно переданный вызывающим кодом X-Request-Id (например, через requestIdHeaders). */
function explicitRequestId(init: RequestOptions): string | null {
  const headers = init.headers as Record<string, string> | undefined
  if (!headers) return null
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'x-request-id' && headers[key]) return headers[key]
  }
  return null
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

  // Явный id вызывающего кода приоритетнее; иначе недавний идентичный запрос
  // оборвался → ретрай с тем же X-Request-Id (бэкенд не задвоит), либо новый id.
  const explicit = explicitRequestId(init)
  const reuse = existing?.failedAt != null && now - existing.failedAt < IDEMPOTENCY_WINDOW_MS
  const requestId = explicit ?? (reuse && existing ? existing.requestId : newRequestId())

  const headers = explicit
    ? (init.headers as Record<string, string>)
    : { ...(init.headers as Record<string, string> | undefined), 'X-Request-Id': requestId }
  const promise = executeRequest<T>(path, { ...init, headers })
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

/** Скачивание защищённого файла (/uploads/*) с Bearer-авторизацией: тот же
 *  401→refresh→повтор, что и у request, но тело возвращается как Blob. */
export async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const init: RequestOptions = { method: 'GET', signal }
  let headers = buildHeaders(path, init, false)
  let response = await doFetch(path, init, headers)

  const hadBearer = typeof headers.Authorization === 'string'
  if (response.status === 401 && hadBearer) {
    const refreshed = await refreshSessionOnce()
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
  try {
    return await response.blob()
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(NETWORK_ERROR, { cause: error })
    }
    throw error
  }
}

async function executeFormRequest<T>(path: string, init: RequestOptions): Promise<T> {
  let headers = buildHeaders(path, init, false)
  let response = await doFetch(path, init, headers)

  const hadBearer = typeof headers.Authorization === 'string'
  if (response.status === 401 && hadBearer && !init.skipRefresh) {
    const refreshed = await refreshSessionOnce()
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

// FormData не сериализуется в строку, поэтому ключ дедупликации multipart-загрузок
// собирается из формы запроса: метод + путь + поля (строки — значением, файлы —
// имя/размер/lastModified). Ретрай той же загрузки строит тот же ключ → переиспользует
// X-Request-Id, и бэкенд не задваивает вложение.
function formIdempotencyKey(path: string, init: RequestOptions): string {
  const method = (init.method ?? 'GET').toUpperCase()
  const parts: string[] = []
  if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
    for (const [name, value] of init.body.entries()) {
      if (typeof value === 'string') parts.push(`${name}=${value}`)
      else parts.push(`${name}=file:${value.name}:${value.size}:${value.lastModified}`)
    }
  }
  return `${method} ${path} form:${parts.join('&')}`
}

// Та же семантика, что idempotentRequest (single-flight + окно ретрая), но ключ —
// по форме multipart-тела и без принудительного Content-Type: application/json.
async function idempotentFormRequest<T>(path: string, init: RequestOptions): Promise<T> {
  const now = Date.now()
  pruneIdempotencyEntries(now)

  const key = formIdempotencyKey(path, init)
  const existing = idempotencyEntries.get(key)

  if (existing?.promise) {
    return existing.promise as Promise<T>
  }

  const explicit = explicitRequestId(init)
  const reuse = existing?.failedAt != null && now - existing.failedAt < IDEMPOTENCY_WINDOW_MS
  const requestId = explicit ?? (reuse && existing ? existing.requestId : newRequestId())

  const headers = explicit
    ? (init.headers as Record<string, string>)
    : { ...(init.headers as Record<string, string> | undefined), 'X-Request-Id': requestId }
  const promise = executeFormRequest<T>(path, { ...init, headers })
  idempotencyEntries.set(key, { requestId, promise })

  try {
    const result = await promise
    idempotencyEntries.delete(key)
    return result
  } catch (err) {
    idempotencyEntries.set(key, { requestId, failedAt: Date.now() })
    throw err
  }
}

/** Как request, но тело — FormData (multipart): Content-Type не задаём, его ставит браузер с boundary. */
export function requestForm<T>(path: string, init: RequestOptions): Promise<T> {
  // Идемпотентность по умолчанию для write-методов; явный idempotent имеет приоритет.
  const idempotent = init.idempotent ?? isWriteRequest(init)
  if (idempotent) return idempotentFormRequest<T>(path, init)
  return executeFormRequest<T>(path, init)
}
