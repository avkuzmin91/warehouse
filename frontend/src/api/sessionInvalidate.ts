import { scheduleHardRedirectToAuth } from '../auth/redirectToAuth'
import { broadcastAuthLogout } from '../auth/tabSync'
import { clearProfileCache } from './profileCache'
import { setAccessTokenMemory } from './tokenStore'

/** 401 с Bearer: сброс сессии, broadcast вкладкам, редирект на вход (как в legacy api.ts). */
export function invalidateSessionAfterUnauthorizedApi(): void {
  setAccessTokenMemory(null)
  clearProfileCache()
  broadcastAuthLogout()
  scheduleHardRedirectToAuth()
}
