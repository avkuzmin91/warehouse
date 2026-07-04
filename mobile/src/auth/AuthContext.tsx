import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { bootstrapSession, login as apiLogin, logout as apiLogout, type Me } from '../api/authApi'
import { setSessionExpiredHandler } from '../api/http'
import { unregisterPushToken } from '../api/pushApi'
import { takePushToken } from '../push/pushToken'

type AuthState = {
  ready: boolean
  user: Me | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<Me | null>(null)
  const bootstrapped = useRef(false)

  useEffect(() => {
    // Истёкший/отозванный refresh в любом запросе → сбрасываем пользователя, Gate
    // вернёт LoginScreen (иначе кладовщик застрял бы на экране с падающими действиями).
    setSessionExpiredHandler(() => setUser(null))
    return () => setSessionExpiredHandler(null)
  }, [])

  useEffect(() => {
    if (bootstrapped.current) return // StrictMode гоняет эффект дважды
    bootstrapped.current = true
    bootstrapSession()
      .then(setUser)
      .finally(() => setReady(true))
  }, [])

  const value: AuthState = {
    ready,
    user,
    login: async (email, password) => {
      setUser(await apiLogin(email, password))
    },
    logout: async () => {
      // Отвязать устройство до logout — запрос требует ещё живой авторизации.
      const pushToken = takePushToken()
      if (pushToken) await unregisterPushToken(pushToken).catch(() => {})
      await apiLogout()
      setUser(null)
    },
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth вне AuthProvider')
  return ctx
}
