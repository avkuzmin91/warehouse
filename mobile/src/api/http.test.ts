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

import { formatApiErrorDetail, request, requestForm, SessionExpiredError } from './http'

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

describe('request — автоматический X-Request-Id для write-методов', () => {
  function captureRequestIds(): { ids: (string | undefined)[]; fail: { current: boolean } } {
    const ids: (string | undefined)[] = []
    const fail = { current: false }
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      ids.push((init?.headers as Record<string, string> | undefined)?.['X-Request-Id'])
      if (fail.current) throw new TypeError('Failed to fetch')
      return jsonResponse(200, { ok: true })
    }) as unknown as typeof fetch
    return { ids, fail }
  }

  it('POST получает автосгенерированный X-Request-Id, GET — нет', async () => {
    const { ids } = captureRequestIds()
    await request('/receipts', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    await request('/receipts')
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBeUndefined()
  })

  it('ретрай после обрыва сети переиспользует тот же X-Request-Id', async () => {
    const { ids, fail } = captureRequestIds()
    fail.current = true
    await expect(request('/receipts', { method: 'POST', body: '{"a":1}' })).rejects.toThrow()
    fail.current = false
    await request('/receipts', { method: 'POST', body: '{"a":1}' })
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBe(ids[0])
  })

  it('после успеха идентичный запрос уходит с новым X-Request-Id', async () => {
    const { ids } = captureRequestIds()
    await request('/receipts', { method: 'POST', body: '{"a":1}' })
    await request('/receipts', { method: 'POST', body: '{"a":1}' })
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBeTruthy()
    expect(ids[1]).not.toBe(ids[0])
  })

  it('явно переданный X-Request-Id имеет приоритет над автоматическим', async () => {
    const { ids } = captureRequestIds()
    await request('/receipts', {
      method: 'POST',
      body: '{"a":1}',
      headers: { 'X-Request-Id': 'explicit-id' },
    })
    expect(ids[0]).toBe('explicit-id')
  })

  it('одновременные одинаковые запросы схлопываются в один fetch (single-flight)', async () => {
    const { ids } = captureRequestIds()
    const [a, b] = await Promise.all([
      request('/receipts', { method: 'POST', body: '{"a":1}' }),
      request('/receipts', { method: 'POST', body: '{"a":1}' }),
    ])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(ids).toHaveLength(1)
  })
})

describe('requestForm — автоматический X-Request-Id для multipart-загрузок', () => {
  function captureRequestIds(): { ids: (string | undefined)[]; fail: { current: boolean } } {
    const ids: (string | undefined)[] = []
    const fail = { current: false }
    global.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      ids.push((init?.headers as Record<string, string> | undefined)?.['X-Request-Id'])
      if (fail.current) throw new TypeError('Failed to fetch')
      return jsonResponse(200, { ok: true })
    }) as unknown as typeof fetch
    return { ids, fail }
  }

  function sameFileForm(): FormData {
    const form = new FormData()
    form.append('file', new File(['data'], 'label.pdf', { lastModified: 42 }))
    return form
  }

  it('POST с FormData получает автосгенерированный X-Request-Id', async () => {
    const { ids } = captureRequestIds()
    await requestForm('/expenses/e1/files', { method: 'POST', body: sameFileForm() })
    expect(ids[0]).toBeTruthy()
  })

  it('ретрай той же формы после обрыва сети переиспользует тот же X-Request-Id', async () => {
    const { ids, fail } = captureRequestIds()
    fail.current = true
    await expect(requestForm('/expenses/e1/files', { method: 'POST', body: sameFileForm() })).rejects.toThrow()
    fail.current = false
    await requestForm('/expenses/e1/files', { method: 'POST', body: sameFileForm() })
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBe(ids[0])
  })

  it('после успеха идентичная загрузка уходит с новым X-Request-Id', async () => {
    const { ids } = captureRequestIds()
    await requestForm('/expenses/e1/files', { method: 'POST', body: sameFileForm() })
    await requestForm('/expenses/e1/files', { method: 'POST', body: sameFileForm() })
    expect(ids[0]).toBeTruthy()
    expect(ids[1]).toBeTruthy()
    expect(ids[1]).not.toBe(ids[0])
  })

  it('разные файлы на одном пути не делят X-Request-Id после обрыва', async () => {
    const { ids, fail } = captureRequestIds()
    fail.current = true
    await expect(requestForm('/expenses/e1/files', { method: 'POST', body: sameFileForm() })).rejects.toThrow()
    fail.current = false
    const other = new FormData()
    other.append('file', new File(['other-data'], 'photo.jpg', { lastModified: 7 }))
    await requestForm('/expenses/e1/files', { method: 'POST', body: other })
    expect(ids[1]).toBeTruthy()
    expect(ids[1]).not.toBe(ids[0])
  })

  it('явно переданный X-Request-Id имеет приоритет над автоматическим', async () => {
    const { ids } = captureRequestIds()
    await requestForm('/expenses/e1/files', {
      method: 'POST',
      body: sameFileForm(),
      headers: { 'X-Request-Id': 'explicit-form-id' },
    })
    expect(ids[0]).toBe('explicit-form-id')
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
