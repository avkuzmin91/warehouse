import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { me } from '../api'
import type { User } from '../api'

const LINKS: { to: string; label: string }[] = [
  { to: '/cabinet', label: 'Сводка' },
  { to: '/cabinet/balances', label: 'Остатки' },
  { to: '/cabinet/receipts', label: 'Поступления' },
  { to: '/cabinet/shipments', label: 'Отгрузки' },
]

export function ClientCabinetLayout() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <PageContainer maxWidth={960}>
        <Breadcrumbs />
        <p className="auth-card__subtitle">Загрузка...</p>
      </PageContainer>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  if (user.role !== 'client') {
    return <Navigate to="/home" replace />
  }

  if (!user.client_id?.trim()) {
    return (
      <PageContainer maxWidth={560} cardClassName="home-card">
        <Breadcrumbs />
        <p className="auth-card__subtitle home-card__status">
          Обратитесь к администратору для активации доступа
        </p>
      </PageContainer>
    )
  }

  return (
    <PageContainer maxWidth={1100} cardClassName="users-card product-dict-card">
      <Breadcrumbs />
      <nav className="cabinet-subnav" aria-label="Разделы личного кабинета">
        {LINKS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/cabinet'}
            className={({ isActive }) =>
              `cabinet-subnav__link${isActive ? ' cabinet-subnav__link--active' : ''}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </PageContainer>
  )
}
