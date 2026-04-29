import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { clearToken, me } from '../api'
import type { User } from '../api'

const LOGO_PATH = '/logo/' + encodeURIComponent('logo main.png')

function LogoutIcon() {
  return (
    <svg className="app-header__logout-icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M16 13v-2H7V8l-5 4 5 4v-3h9zM20 3h-8c-1.1 0-2 .9-2 2v4h2V5h8v14h-8v-4h-2v4c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
      />
    </svg>
  )
}

export function Header() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => {
        setUser(null)
      })
  }, [])

  function handleLogout() {
    clearToken()
    navigate('/auth', { replace: true })
  }

  return (
    <header className="app-header" role="banner">
      <div className="app-header__inner">
        <Link className="app-header__brand" to="/home" title="На главную">
          <img className="app-header__logo" src={LOGO_PATH} alt="На главную" />
        </Link>
        <div className="app-header__right">
          {user ? (
            <span className="app-header__user" title={user.email}>
              {user.email}
            </span>
          ) : null}
          <button
            className="app-header__logout"
            type="button"
            onClick={handleLogout}
            title="Выйти"
            aria-label="Выйти из системы"
          >
            <LogoutIcon />
          </button>
        </div>
      </div>
    </header>
  )
}
