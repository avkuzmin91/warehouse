import { useEffect, useState } from 'react'
import { CONNECTIVITY_EVENT, isNetworkDown } from '../api/http'
import { Icon } from './Icon'

function offlineNow(): boolean {
  return (typeof navigator !== 'undefined' && navigator.onLine === false) || isNetworkDown()
}

/** Глобальный баннер «Нет соединения» под safe-top. Показывается по navigator.onLine
 *  и по сетевым фейлам http.ts; скрывается при восстановлении. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(offlineNow)

  useEffect(() => {
    const update = () => setOffline(offlineNow())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    window.addEventListener(CONNECTIVITY_EVENT, update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener(CONNECTIVITY_EVENT, update)
    }
  }, [])

  if (!offline) return null
  return (
    <div className="offline-banner" role="status">
      <Icon name="alert" size={14} />
      Нет соединения
    </div>
  )
}
