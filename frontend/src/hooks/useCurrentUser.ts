import { useState, useEffect } from 'react'
import { me } from '../api/sessionAuth'
import type { User } from '../api/typesUser'

export interface CurrentUser {
  user: User | null
  loading: boolean
}

export function useCurrentUser(): CurrentUser {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    me()
      .then((u) => { if (!cancelled) { setUser(u); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { user, loading }
}
