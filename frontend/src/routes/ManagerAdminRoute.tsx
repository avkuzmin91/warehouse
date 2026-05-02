import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { me } from '../api'
import { AccessDeniedPage } from '../pages/AccessDeniedPage'

type ManagerAdminRouteProps = {
  children: ReactNode
}

export function ManagerAdminRoute({ children }: ManagerAdminRouteProps) {
  const token = localStorage.getItem('token')
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!token) {
      setIsAllowed(false)
      return
    }

    me()
      .then((user) => {
        setIsAllowed(user.role === 'admin' || user.role === 'manager')
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
      <PageContainer maxWidth={680}>
        <Breadcrumbs />
        <p className="auth-card__subtitle">Проверка доступа...</p>
      </PageContainer>
    )
  }

  if (!isAllowed) {
    return <AccessDeniedPage />
  }

  return children
}
