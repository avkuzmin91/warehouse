import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { ensureSessionBootstrapped, me } from '../../api/sessionAuth'
import { postAuthLandingPath } from '../../utils/postLoginRedirect'
import { LoadingScreen } from '../feedback/LoadingScreen'

type CheckState = 'pending' | 'guest' | 'authed'

export function AuthLayout() {
  const [state, setState] = useState<CheckState>('pending')
  const [landingPath, setLandingPath] = useState('/home')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await ensureSessionBootstrapped()
      if (cancelled) return
      if (!ok) { setState('guest'); return }
      try {
        const user = await me()
        if (!cancelled) {
          setLandingPath(postAuthLandingPath(user))
          setState('authed')
        }
      } catch {
        if (!cancelled) setState('guest')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (state === 'pending') {
    return <LoadingScreen label="Проверка сессии…" />
  }

  if (state === 'authed') {
    return <Navigate to={landingPath} replace />
  }

  return <Outlet />
}
