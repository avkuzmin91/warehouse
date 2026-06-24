import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Изолируем http.ts от платформенных модулей: веб-путь (IS_NATIVE=false), токен в наличии.
vi.mock('./constants', () => ({
  API_BASE_URL: '',
  AUTH_FETCH_CREDENTIALS: 'include' as RequestCredentials,
  IS_NATIVE: false,
}))

const h = vi.hoisted(() => ({ token: 'tok' as string | null, refreshCalls: 0 }))

vi.mock('./tokenStore', () => ({
  getToken: () => h.token,
  getRefresh: () => null,
  applyAuthTokens: async () => {},
  clearTokens: async () => {
    h.token = null
  },
}))

import { formatApiErrorDetail, request, SessionExpiredError } from './http'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  h.token = 'tok'
  h.refreshCalls = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('request — обновление сессии на 401', () => {
  it('одна попытка refresh + повтор возвращает данные', async () => {
    let dataCalls = 0
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/refresh')) {
        h.refreshCalls++
        return jsonResponse(200, { access_token: 'new' })
      }
      dataCalls++
      return dataCalls === 1 ? jsonResponse(401, { detail: 'нет' }) : jsonResponse(200, { ok: true })
    }) as unknown as typeof fetch

    const res = await request<{ ok: boolean }>('/receipts')
    expect(res).toEqual({ ok: true })
    expect(h.refreshCalls).toBe(1)
  })

  it('дедуплицирует одновременные refresh (refresh вызывается один раз)', async () => {
    let dataCalls = 0
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/refresh')) {
        h.refreshCalls++
        return jsonResponse(200, { access_token: 'new' })
      }
      dataCalls++
      // Первые два запроса (две параллельные загрузки) получают 401, после refresh — 200.
      return dataCalls <= 2 ? jsonResponse(401, { detail: 'нет' }) : jsonResponse(200, { ok: true })
    }) as unknown as typeof fetch

    const [a, b] = await Promise.all([request('/receipts'), request('/shipments')])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(h.refreshCalls).toBe(1)
  })

  it('повторный 401 после refresh → SessionExpiredError и сброс токена', async () => {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/auth/refresh')) return jsonResponse(200, { access_token: 'new' })
      return jsonResponse(401, { detail: 'нет' })
    }) as unknown as typeof fetch

    await expect(request('/receipts')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(h.token).toBeNull()
  })
})

describe('formatApiErrorDetail', () => {
  it('строковый detail возвращается как есть', () => {
    expect(formatApiErrorDetail({ detail: 'Документ не найден' }, 404)).toBe('Документ не найден')
  })

  it('массив валидации FastAPI собирается в строку с именем поля', () => {
    const body = { detail: [{ loc: ['body', 'email'], msg: 'обязательное поле' }] }
    expect(formatApiErrorDetail(body, 422)).toBe('email: обязательное поле')
  })

  it('пустое тело → дружелюбный фолбэк с кодом', () => {
    expect(formatApiErrorDetail(null, 500)).toContain('500')
  })
})
