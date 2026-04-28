import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearToken, me } from '../api'
import type { User } from '../api'

export function DashboardPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    me()
      .then(setUser)
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : 'Не удалось получить профиль')
      })
  }, [])

  function handleLogout() {
    clearToken()
    navigate('/auth')
  }

  return (
    <main className="page">
      <section className="auth-card dashboard-card">
        <h1 className="auth-card__title">Личный кабинет</h1>
        {user ? (
          <>
            <p className="auth-card__subtitle">
              Ура, вы вошли под учетной записью <strong>{user.email}</strong>!
            </p>
            {user.role === 'admin' ? (
              <>
                <Link className="btn btn--primary dashboard-link" to="/users">
                  Список пользователей
                </Link>
                <Link className="btn btn--primary dashboard-link" to="/dictionaries">
                  Справочники
                </Link>
              </>
            ) : null}
          </>
        ) : (
          <p className="auth-card__subtitle">{error || 'Загрузка профиля...'}</p>
        )}
        <button className="btn btn--secondary" type="button" onClick={handleLogout}>
          Выйти
        </button>
      </section>
    </main>
  )
}
