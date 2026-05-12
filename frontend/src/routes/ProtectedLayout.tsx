import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { getToken, me } from '../api'
import { isSessionExpiredError } from '../auth/sessionError'
import { AppLayout } from '../components/AppLayout'

/**
 * Защищённые маршруты: наличие токена + проверка `/auth/me` до рендера приложения.
 * При 401 централизованно — редирект на `/auth` из `api.ts`, без «тихого» доступа к layout.
 */
export function ProtectedLayout() {
  const token = getToken()
  const [sessionChecked, setSessionChecked] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    me()
      .then(() => {
        if (!cancelled) setSessionChecked(true)
      })
      .catch((e) => {
        if (isSessionExpiredError(e)) return
        if (!cancelled) setSessionChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  if (!token) {
    return <Navigate to="/auth" replace />
  }

  if (!sessionChecked) {
    return (
      <div className="auth-shell">
        <div className="page" style={{ padding: 24 }}>
          <p className="auth-card__subtitle">Проверка сессии…</p>
        </div>
      </div>
    )
  }

  return <AppLayout />
}
