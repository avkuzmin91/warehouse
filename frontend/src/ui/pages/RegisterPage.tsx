import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { register } from '../../api/sessionAuth'
import { Icon } from '../primitives/Icon'
import { Field } from '../primitives/Input'

export function RegisterPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
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
      <div className="auth-backdrop" aria-hidden="true">
        <svg className="auth-backdrop-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="auth-grid-reg" width="56" height="56" patternUnits="userSpaceOnUse">
              <path d="M 56 0 L 0 0 0 56" fill="none" stroke="var(--c-border)" strokeWidth="1" />
            </pattern>
            <radialGradient id="auth-glow-reg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="1440" height="900" fill="url(#auth-grid-reg)" opacity="0.6" />
          <circle cx="720" cy="450" r="480" fill="url(#auth-glow-reg)" />
        </svg>
      </div>

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-head">
            <div className="auth-eyebrow">pack-men · WMS</div>
            <h1 className="auth-title">Создать аккаунт</h1>
            <div className="auth-sub">Аккаунт создаётся администратором склада</div>
          </div>

          <div className="auth-segmented">
            <Link to="/auth" className="auth-seg" style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              Вход
            </Link>
            <button className="auth-seg on" disabled>Регистрация</button>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <Field label="Рабочий email" required>
              <div style={{ position: 'relative' }}>
                <Icon name="mail" size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--c-text-subtle)' }} />
                <input
                  className="input auth-input"
                  style={{ paddingLeft: 36 }}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.ru"
                  autoComplete="email"
                />
              </div>
            </Field>

            <Field label="Пароль" required help="Минимум 8 символов">
              <div style={{ position: 'relative' }}>
                <Icon name="lock" size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--c-text-subtle)' }} />
                <input
                  className="input auth-input"
                  style={{ paddingLeft: 36 }}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 8 символов"
                  autoComplete="new-password"
                />
              </div>
            </Field>

            <Field label="Подтвердите пароль" required>
              <div style={{ position: 'relative' }}>
                <Icon name="lock" size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--c-text-subtle)' }} />
                <input
                  className="input auth-input"
                  style={{ paddingLeft: 36 }}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Повторите пароль"
                  autoComplete="new-password"
                />
              </div>
            </Field>

            {error && (
              <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>
            )}

            <button type="submit" className="btn primary auth-submit" disabled={loading}>
              {loading ? 'Создание…' : 'Создать аккаунт'}
              {!loading && <Icon name="arrowRight" size={14} />}
            </button>
          </form>
        </div>
      </main>

      <footer className="auth-footer">
        <span style={{ textAlign: 'center' }}>© Pack-men, 2026</span>
      </footer>
    </div>
  )
}
