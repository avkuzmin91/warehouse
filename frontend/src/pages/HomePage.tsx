import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { me } from '../api'
import type { User } from '../api'
import { postAuthLandingPath } from '../utils/postLoginRedirect'

type NavItem = {
  key: string
  label: string
  to: string
  visible: (role: User['role'], clientId?: string | null) => boolean
}

const NAV: NavItem[] = [
  {
    key: 'dictionaries',
    label: 'Справочники',
    to: '/dictionaries',
    visible: (role) => role === 'admin',
  },
  {
    key: 'inventory',
    label: 'Учет товаров',
    to: '/inventory',
    visible: (role) => role === 'admin' || role === 'manager',
  },
  {
    key: 'analytics',
    label: 'Аналитика',
    to: '/analytics',
    visible: (role) => role === 'admin',
  },
  {
    key: 'cabinet',
    label: 'Личный кабинет',
    to: '/cabinet',
    visible: (role, clientId) => role === 'client' && !!clientId?.trim(),
  },
]

export function HomePage() {
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    me()
      .then(setUser)
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : 'Не удалось получить профиль')
      })
  }, [])

  const items = user ? NAV.filter((item) => item.visible(user.role, user.client_id)) : []
  const showEmpty = user && items.length === 0
  const clientNeedsActivation = user?.role === 'client' && !user.client_id?.trim()
  const loading = !user && !error

  if (user && postAuthLandingPath(user) === '/cabinet') {
    return <Navigate to="/cabinet" replace />
  }

  return (
    <PageContainer maxWidth={520} cardClassName="home-card">
      <Breadcrumbs />

      {loading ? <p className="auth-card__subtitle home-card__status">Загрузка...</p> : null}
      {error ? <p className="error-text home-card__status">{error}</p> : null}

      {user && !error ? (
        clientNeedsActivation ? (
          <p className="auth-card__subtitle home-card__empty">
            Обратитесь к администратору для активации доступа
          </p>
        ) : showEmpty ? (
          <p className="auth-card__subtitle home-card__empty">Нет доступных разделов</p>
        ) : (
          <ul className="home-nav" role="list">
            {items.map((item) => (
              <li key={item.key} className="home-nav__item">
                <Link className="home-nav__link" to={item.to}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </PageContainer>
  )
}
