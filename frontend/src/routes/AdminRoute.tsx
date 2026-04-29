import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { me } from '../api'
import { AccessDeniedPage } from '../pages/AccessDeniedPage'

type AdminRouteProps = {
  children: ReactNode
}

export function AdminRoute({ children }: AdminRouteProps) {
  const token = localStorage.getItem('token')
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!token) {
      setIsAllowed(false)
      return
    }

    me()
      .then((user) => {
        setIsAllowed(user.role === 'admin')
      })
      .catch(() => {
        setIsAllowed(false)
      })
  }, [token])

  if (!token) {
    return <Navigate to="/auth" replace />
  }

  if (isAllowed === null) {
    return (
      <main className="page">
        <section className="auth-card lk-card">
          <Breadcrumbs />
          <p className="auth-card__subtitle">Проверка доступа...</p>
        </section>
      </main>
    )
  }

  if (!isAllowed) {
    return <AccessDeniedPage />
  }

  return children
}
