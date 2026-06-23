import { Capacitor } from '@capacitor/core'

// Нативная обёртка (Android). На вебе false — там сессия живёт в refresh-cookie.
export const IS_NATIVE = Capacitor.isNativePlatform()

function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return fromEnv.trim().replace(/\/$/, '')
  }
  // Браузер: относительный /api через Vite-прокси. Нативная сборка обязана задать
  // VITE_API_BASE_URL (абсолютный URL), иначе запросы уйдут в никуда.
  return '/api'
}

export const API_BASE_URL = resolveApiBaseUrl()

// В браузере нужен include (refresh-cookie wms_rt). На нативе cookie не работает —
// там сессию держит мобильный токен-режим (X-Client: mobile, refresh в теле +
// secure storage, см. secureStore.ts и docs/mobile-plan.md §6.1).
export const AUTH_FETCH_CREDENTIALS: RequestCredentials = 'include'
