import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login, me, saveToken } from '../../api/sessionAuth'
import { postAuthLandingPath } from '../../utils/postLoginRedirect'
import { Icon } from '../primitives/Icon'
import { Checkbox } from '../primitives/Checkbox'
import { Field } from '../primitives/Input'

function AuthBackdrop() {
  return (
    <div className="auth-backdrop" aria-hidden="true">
      <svg className="auth-backdrop-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <pattern id="auth-grid-v2" width="56" height="56" patternUnits="userSpaceOnUse">
            <path d="M 56 0 L 0 0 0 56" fill="none" stroke="var(--c-border)" strokeWidth="1" />
          </pattern>
          <radialGradient id="auth-glow-1-v2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="auth-glow-2-v2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1440" height="900" fill="url(#auth-grid-v2)" opacity="0.6" />
        <circle cx="200" cy="180" r="380" fill="url(#auth-glow-1-v2)" />
        <circle cx="1280" cy="780" r="420" fill="url(#auth-glow-2-v2)" />
        <g opacity="0.5">
          {Array.from({ length: 18 }).map((_, i) => {
            const x = 120 + i * 80
            const y = 760 - Math.sin(i * 0.6) * 40
            const r = 3 + (i % 3 === 0 ? 1.5 : 0)
            return <circle key={i} cx={x} cy={y} r={r} fill="var(--c-accent)" opacity={0.3 + (i / 18) * 0.5} />
          })}
        </g>
        <g transform="translate(160, 140)">
          <path d="M 38.95 -15.74 A 42 42 0 1 0 38.95 15.74 L 0 0 Z" fill="#3730a3" opacity="0.9" />
          <circle cx="8" cy="-22" r="4.5" fill="#fafaf9" />
        </g>
      </svg>
    </div>
  )
}

export function LoginPage() {
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
      <AuthBackdrop />
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-head">
            <div className="auth-eyebrow">pack-men · WMS</div>
            <h1 className="auth-title">С возвращением</h1>
            <div className="auth-sub">Войдите, чтобы продолжить работу со складом</div>
          </div>

          <div className="auth-segmented">
            <button className="auth-seg on" disabled>Вход</button>
            <Link to="/auth/register" className="auth-seg" style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>
              Регистрация
            </Link>
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

            <div className="field">
              <label className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Пароль <span style={{ color: 'var(--c-danger)' }}>*</span></span>
              </label>
              <div style={{ position: 'relative' }}>
                <Icon name="lock" size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--c-text-subtle)' }} />
                <input
                  className="input auth-input"
                  style={{ paddingLeft: 36, paddingRight: 36 }}
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 8 символов"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="btn ghost icon sm"
                  style={{ position: 'absolute', right: 4, top: 4, height: 30, width: 30 }}
                  onClick={() => setShowPw((s) => !s)}
                >
                  <Icon name="eye" size={13} />
                </button>
              </div>
            </div>

            <label className="auth-remember">
              <Checkbox checked={remember} onChange={setRemember} />
              <span>Запомнить меня на этом устройстве</span>
            </label>

            {error && (
              <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>
            )}

            <button type="submit" className="btn primary auth-submit" disabled={loading}>
              {loading ? 'Вход…' : 'Войти'}
              {!loading && <Icon name="arrowRight" size={14} />}
            </button>
          </form>
        </div>
      </main>

      <footer className="auth-footer">
        <span style={{ textAlign: 'center' }}>© Pack-men, 2026</span>
        <div className="auth-footer-links" />
      </footer>
    </div>
  )
}
