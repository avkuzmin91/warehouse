/**
 * Basename для React Router и абсолютный путь входа для `window.location`
 * (Vite `import.meta.env.BASE_URL`, деплой в подкаталог).
 */
export function routerBasename(): string | undefined {
  const raw = import.meta.env.BASE_URL ?? '/'
  if (raw === '/' || raw === './') return undefined
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

/** Путь для полного редиректа (вне `<Navigate>`), совпадает с маршрутом `/auth` в `App.tsx`. */
export function authEntryHref(): string {
  const b = routerBasename()
  return b ? `${b}/auth` : '/auth'
}
