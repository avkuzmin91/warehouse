import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { authLogout, me } from '../api'
import type { User } from '../api'
import { postAuthLandingPath } from '../utils/postLoginRedirect'

const LOGO_PATH = '/logo/' + encodeURIComponent('logo main.png')

function UserPersonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 4c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm0 14c-2.03 0-4.43-.82-6.14-2.88a9.947 9.947 0 0 1 12.28 0C16.43 19.18 14.03 20 12 20z"
      />
    </svg>
  )
}

function MenuKeyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"
      />
    </svg>
  )
}

function MenuLogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M16 13v-2H7V8l-5 4 5 4v-3h9zM20 3h-8c-1.1 0-2 .9-2 2v4h2V5h8v14h-8v-4h-2v4c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
      />
    </svg>
  )
}

export function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState<User | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    me()
      .then(setUser)
      .catch(() => {
        setUser(null)
      })
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return

    function onPointerDown(event: PointerEvent) {
      const el = menuRef.current
      if (!el || el.contains(event.target as Node)) return
      setMenuOpen(false)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  async function handleLogout() {
    setMenuOpen(false)
    await authLogout()
    navigate('/auth', { replace: true })
  }

  return (
    <header className="app-header" role="banner">
      <div className="app-header__inner">
        <Link
          className="app-header__brand"
          to={user ? postAuthLandingPath(user) : '/home'}
          title={user && postAuthLandingPath(user) === '/cabinet' ? 'В личный кабинет' : 'На главную'}
        >
          <img
            className="app-header__logo"
            src={LOGO_PATH}
            alt={user && postAuthLandingPath(user) === '/cabinet' ? 'В личный кабинет' : 'На главную'}
          />
        </Link>
        <div className="app-header__right">
          {user ? (
            <div className="app-header__user-menu" ref={menuRef}>
              <button
                type="button"
                className="app-header__user-trigger"
                id="app-header-user-trigger"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-controls="app-header-user-menu"
                title={user.email}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span className="app-header__user-email">{user.email}</span>
                <UserPersonIcon className="app-header__user-trigger-icon" />
              </button>
              {menuOpen ? (
                <div
                  id="app-header-user-menu"
                  className="app-header__dropdown"
                  role="menu"
                  aria-labelledby="app-header-user-trigger"
                >
                  <Link
                    role="menuitem"
                    className="app-header__menu-item"
                    to="/account/password"
                    onClick={() => setMenuOpen(false)}
                  >
                    <MenuKeyIcon className="app-header__menu-item-icon" />
                    <span>Сменить пароль</span>
                  </Link>
                  <button
                    role="menuitem"
                    type="button"
                    className="app-header__menu-item"
                    onClick={handleLogout}
                  >
                    <MenuLogoutIcon className="app-header__menu-item-icon" />
                    <span>Выйти</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
