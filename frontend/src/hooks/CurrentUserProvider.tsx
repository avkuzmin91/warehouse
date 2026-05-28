import { useEffect, useState, type ReactNode } from 'react'
import { me } from '../api/sessionAuth'
import { WMS_AUTH_BROADCAST } from '../auth/tabSync'
import type { User } from '../api/typesUser'
import { CurrentUserContext } from './currentUserContext'

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    me(ctrl.signal)
      .then((u: User) => { if (!ctrl.signal.aborted) { setUser(u); setLoading(false) } })
      .catch(() => { if (!ctrl.signal.aborted) { setUser(null); setLoading(false) } })
    return () => ctrl.abort()
  }, [reloadTick])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    let bc: BroadcastChannel
    try {
      bc = new BroadcastChannel(WMS_AUTH_BROADCAST)
    } catch {
      return
    }
    bc.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'logout') {
        setUser(null)
      } else if (ev.data?.type === 'login') {
        setReloadTick((t) => t + 1)
      }
    }
    return () => bc.close()
  }, [])

  return (
    <CurrentUserContext.Provider value={{ user, loading }}>
      {children}
    </CurrentUserContext.Provider>
  )
}
