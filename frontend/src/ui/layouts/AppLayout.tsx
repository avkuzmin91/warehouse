import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { ensureSessionBootstrapped, getToken, me } from '../../api/sessionAuth'
import { isSessionExpiredError } from '../../auth/sessionError'
import { AppShell } from '../shell/AppShell'
import { ConfirmDialogProvider } from '../feedback/ConfirmDialog'
import { ToastProvider } from '../feedback/Toast'

type BootState = 'pending' | 'guest' | 'checking' | 'ready'

export function AppLayout() {
  const [boot, setBoot] = useState<BootState>('pending')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const ok = await ensureSessionBootstrapped()
        if (cancelled) return
        if (!ok) { setBoot('guest'); return }
        setBoot('checking')
        await me()
        if (!cancelled) setBoot('ready')
      } catch (e) {
        if (isSessionExpiredError(e)) return
        if (!cancelled) setBoot(getToken() ? 'ready' : 'guest')
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (boot === 'pending' || boot === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--c-text-muted)', fontSize: 13 }}>
        Проверка сессии…
      </div>
    )
  }

  if (boot === 'guest' || !getToken()) {
    return <Navigate to="/auth" replace />
  }

  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <AppShell />
      </ConfirmDialogProvider>
    </ToastProvider>
  )
}
