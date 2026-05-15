import { useEffect } from 'react'
import { clearToken } from '../api'
import { authEntryHref } from '../utils/routerBase'
import { scheduleHardRedirectToAuth } from './redirectToAuth'
import { WMS_AUTH_BROADCAST } from './tabSync'

/**
 * Слушает выход в других вкладках: сброс access-токена в памяти и редирект на вход.
 */
export function AuthTabSync() {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') {
      return
    }
    let bc: BroadcastChannel
    try {
      bc = new BroadcastChannel(WMS_AUTH_BROADCAST)
    } catch {
      return
    }
    bc.onmessage = (ev: MessageEvent) => {
      if (!ev.data || ev.data.type !== 'logout') {
        return
      }
      clearToken()
      const path = window.location.pathname
      const auth = authEntryHref()
      if (path !== auth && !path.startsWith(`${auth}/`)) {
        scheduleHardRedirectToAuth()
      }
    }
    return () => bc.close()
  }, [])
  return null
}
