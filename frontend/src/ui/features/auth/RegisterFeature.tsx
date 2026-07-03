import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { register } from '../../../api/sessionAuth'
import { Icon } from '../../primitives/Icon'

function AuthBackground() {
  return (
    <>
      <div className="auth-blob auth-blob-1" aria-hidden="true" />
      <div className="auth-blob auth-blob-2" aria-hidden="true" />
      <div className="auth-blob auth-blob-3" aria-hidden="true" />
      <div className="auth-backdrop" aria-hidden="true">
        <svg className="auth-backdrop-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="auth-dots-reg" width="28" height="28" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" />
            </pattern>
          </defs>
          <rect width="1440" height="900" fill="url(#auth-dots-reg)" />
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

export function RegisterFeature() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const trimmed = email.trim()
    if (!trimmed) { setError('Email обязателен'); return }
    if (password.length < 8) { setError('Пароль минимум 8 символов'); return }
    if (password !== confirmPassword) { setError('Пароли не совпадают'); return }
    try {
      setLoading(true)
      await register(trimmed, password)
      navigate('/auth')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации')
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
            <h1 className="auth-title">Создать аккаунт</h1>
            <div className="auth-sub">Аккаунт создаётся администратором склада</div>
          </div>

          {/* Tab switcher */}
          <div className="auth-segmented">
            <Link
              to="/auth"
              className="auth-seg"
              style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
            >
              Вход
            </Link>
            <button className="auth-seg on" disabled>Регистрация</button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate>
            <div className="auth-field-wrap">
              {/* Email */}
              <div className="auth-field">
                <label className="auth-label" htmlFor="reg-email">
                  <span>Рабочий email <span className="auth-label-req">*</span></span>
                </label>
                <div className="auth-input-wrap">
                  <span className="auth-input-icon">
                    <Icon name="mail" size={16} />
                  </span>
                  <input
                    id="reg-email"
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
                <label className="auth-label" htmlFor="reg-password">
                  <span>Пароль <span className="auth-label-req">*</span></span>
                  <span className="auth-label-hint">Минимум 8 символов</span>
                </label>
                <div className="auth-input-wrap">
                  <span className="auth-input-icon">
                    <Icon name="lock" size={16} />
                  </span>
                  <input
                    id="reg-password"
                    className={`auth-input${error ? ' error' : ''}`}
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError('') }}
                    placeholder="Придумайте пароль"
                    autoComplete="new-password"
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

              {/* Confirm password */}
              <div className="auth-field">
                <label className="auth-label" htmlFor="reg-confirm">
                  <span>Подтвердите пароль <span className="auth-label-req">*</span></span>
                </label>
                <div className="auth-input-wrap">
                  <span className="auth-input-icon">
                    <Icon name="lock" size={16} />
                  </span>
                  <input
                    id="reg-confirm"
                    className={`auth-input${error ? ' error' : ''}`}
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError('') }}
                    placeholder="Повторите пароль"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="auth-pw-toggle"
                    onClick={() => setShowConfirm((s) => !s)}
                    tabIndex={-1}
                    aria-label={showConfirm ? 'Скрыть пароль' : 'Показать пароль'}
                  >
                    <Icon name="eye" size={15} />
                  </button>
                </div>
              </div>
            </div>

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
                ? <><span className="auth-spinner" /> Создание…</>
                : <><span>Создать аккаунт</span><Icon name="arrowRight" size={15} /></>
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
