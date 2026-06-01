function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim().replace(/\/$/, '')
  }
  return '/api'
}

/** База URL API: только относительный `/api`; прокси (Vite/nginx) отправляет запрос на backend без этого префикса. */
export const API_BASE_URL = resolveApiBaseUrl()

export const AUTH_FETCH_CREDENTIALS: RequestCredentials = 'include'

/** Пути с API (`/uploads/...`) в `<img>` на другом origin; полные URL не трогаем. */
export function resolvePublicUploadSrc(url: string): string {
  const s = String(url).trim()
  if (!s) return s
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('/')) return `${API_BASE_URL}${s}`
  return s
}
