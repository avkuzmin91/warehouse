import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import type { User } from '../api'
import { getToken, me } from '../api'
import { AccessDeniedPage } from '../pages/AccessDeniedPage'

export type RoleRestrictedGate = 'admin' | 'manager_admin'

function userMatchesGate(user: User, gate: RoleRestrictedGate): boolean {
  if (gate === 'admin') {
    return user.role === 'admin'
  }
  return user.role === 'admin' || user.role === 'manager' || user.role === 'warehouse_manager'
}

type RoleRestrictedRouteProps = {
  children: ReactNode
  gate: RoleRestrictedGate
}

export function RoleRestrictedRoute({ children, gate }: RoleRestrictedRouteProps) {
  const token = getToken()
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!token) {
      setIsAllowed(false)
      return
    }

    me()
      .then((user) => {
        setIsAllowed(userMatchesGate(user, gate))
      })
      .catch(() => {
        setIsAllowed(false)
      })
  }, [token, gate])

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
