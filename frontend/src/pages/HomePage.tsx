import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { me } from '../api'
import type { User } from '../api'

type NavItem = {
  key: string
  label: string
  to: string
  visible: (role: User['role']) => boolean
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

  const items = user ? NAV.filter((item) => item.visible(user.role)) : []
  const showEmpty = user && items.length === 0
  const loading = !user && !error

  return (
    <main className="page page--center">
      <section className="auth-card home-card">
        <Breadcrumbs />

        {loading ? <p className="auth-card__subtitle home-card__status">Загрузка...</p> : null}
        {error ? <p className="error-text home-card__status">{error}</p> : null}

        {user && !error ? (
          showEmpty ? (
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
      </section>
    </main>
  )
}
