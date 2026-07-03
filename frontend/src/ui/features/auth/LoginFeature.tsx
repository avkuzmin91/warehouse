import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login, me, saveToken } from '../../../api/sessionAuth'
import { postAuthLandingPath } from '../../../utils/postLoginRedirect'
import { Icon } from '../../primitives/Icon'
import { Checkbox } from '../../primitives/Checkbox'

function AuthBackground() {
  return (
    <>
      <div className="auth-blob auth-blob-1" aria-hidden="true" />
      <div className="auth-blob auth-blob-2" aria-hidden="true" />
      <div className="auth-blob auth-blob-3" aria-hidden="true" />
      <div className="auth-backdrop" aria-hidden="true">
        <svg className="auth-backdrop-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="auth-dots" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" />
            </pattern>
          </defs>
          <rect width="1440" height="900" fill="url(#auth-dots)" />
        </svg>
      </div>
    </>
  )
}

function BrandLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        fill="white"
        fillOpacity="0.9"
      />
    </svg>
  )
}

export function LoginFeature() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!email || !password) { setError('Заполните email и пароль'); return }
    try {
      setLoading(true)
      const res = await login(email, password)
      saveToken(res.access_token)
      const user = await me()
      navigate(postAuthLandingPath(user))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <AuthBackground />

      <main className="auth-main">
        <div className="auth-card">
          {/* Brand */}
          <div className="auth-brand">
            <div className="auth-brand-logo">
              <BrandLogo />
            </div>
            <div>
              <div className="auth-brand-name">Pack-Men</div>
              <div className="auth-brand-tag">WMS Platform</div>
            </div>
          </div>

          {/* Heading */}
          <div className="auth-card-head">
            <h1 className="auth-title">С возвращением</h1>
            <div className="auth-sub">Войдите, чтобы продолжить работу со складом</div>
          </div>

          {/* Tab switcher */}
          <div className="auth-segmented">
            <button className="auth-seg on" disabled>Вход</button>
            <Link
              to="/auth/register"
              className="auth-seg"
              style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
            >
              Регистрация
            </Link>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-field-wrap">
              {/* Email */}
              <div className="auth-field">
                <label className="auth-label" htmlFor="auth-email">
                  <span>Рабочий email <span className="auth-label-req">*</span></span>
                </label>
                <div className="auth-input-wrap">
                  <span className="auth-input-icon">
                    <Icon name="mail" size={16} />
                  </span>
                  <input
                    id="auth-email"
                    className={`auth-input${error ? ' error' : ''}`}
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError('') }}
                    placeholder="you@company.ru"
                    autoComplete="email"
                    autoFocus
                  />
                </div>
              </div>

              {/* Password */}
              <div className="auth-field">
                <label className="auth-label" htmlFor="auth-password">
                  <span>Пароль <span className="auth-label-req">*</span></span>
                  <a href="#" className="auth-forgot" tabIndex={-1}>Забыли пароль?</a>
                </label>
                <div className="auth-input-wrap">
                  <span className="auth-input-icon">
                    <Icon name="lock" size={16} />
                  </span>
                  <input
                    id="auth-password"
                    className={`auth-input${error ? ' error' : ''}`}
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    placeholder="Минимум 8 символов"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="auth-pw-toggle"
                    onClick={() => setShowPw((s) => !s)}
                    tabIndex={-1}
                    aria-label={showPw ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    <Icon name="eye" size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/* Remember me */}
            <label className="auth-remember">
              <Checkbox checked={remember} onChange={setRemember} />
              <span>Запомнить меня на этом устройстве</span>
            </label>

            {/* Error */}
            {error && (
              <div className="auth-error">
                <Icon name="alert" size={14} />
                {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading
                ? <><span className="auth-spinner" /> Вход…</>
                : <><span>Войти</span><Icon name="arrowRight" size={15} /></>
              }
            </button>
          </form>
        </div>
      </main>

      <footer className="auth-footer">
        © Pack-Men, 2026. Все права защищены.
      </footer>
    </div>
  )
}
