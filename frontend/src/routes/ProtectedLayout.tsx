import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ensureSessionBootstrapped, getToken, me } from '../api'
import { isSessionExpiredError } from '../auth/sessionError'
import { AppLayout } from '../components/AppLayout'

type BootState = 'pending' | 'guest' | 'checking' | 'ready'

export function ProtectedLayout() {
  const [boot, setBoot] = useState<BootState>('pending')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await ensureSessionBootstrapped()
      if (cancelled) return
      if (!ok) {
        setBoot('guest')
        return
      }
      setBoot('checking')
      try {
        await me()
        if (!cancelled) setBoot('ready')
      } catch (e) {
        if (isSessionExpiredError(e)) return
        if (!cancelled) setBoot('ready')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (boot === 'pending' || boot === 'checking') {
    return (
      <div className="auth-shell">
        <div className="page" style={{ padding: 24 }}>
          <p className="auth-card__subtitle">Проверка сессии…</p>
        </div>
      </div>
    )
  }

  if (boot === 'guest' || !getToken()) {
    return <Navigate to="/auth" replace />
  }

  return <AppLayout />
}
