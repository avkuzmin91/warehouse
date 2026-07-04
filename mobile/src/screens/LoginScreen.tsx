import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Icon } from '../components/Icon'
import { BrandMark } from '../components/Brand'
import { APP_VERSION } from '../version'

export function LoginScreen() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <form className="login" onSubmit={onSubmit}>
        <div className="login-top">
          <div className="login-mark">
            <BrandMark size={30} />
          </div>
          <h1 className="login-h">Склад в кармане</h1>
          <div className="login-sub">Войдите, чтобы продолжить работу у стеллажа</div>
        </div>

        <div className="login-form">
          {error && (
            <div className="alert">
              <Icon name="alert" size={15} />
              {error}
            </div>
          )}

          <div className="field">
            <div className="flabel">Логин или e-mail</div>
            <div className="inputwrap">
              <span className="lead">
                <Icon name="user" size={18} />
              </span>
              <input
                className="input"
                type="text"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.ru"
              />
            </div>
          </div>

          <div className="field">
            <div className="flabel">Пароль</div>
            <div className="inputwrap">
              <span className="lead">
                <Icon name="lock" size={18} />
              </span>
              <input
                className="input"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{ paddingRight: 44 }}
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? 'Скрыть пароль' : 'Показать пароль'}
                style={{
                  position: 'absolute',
                  right: 12,
                  display: 'flex',
                  background: 'none',
                  border: 0,
                  color: 'var(--c-text-subtle)',
                  cursor: 'pointer',
                  padding: 4,
                }}
              >
                <Icon name="eye" size={18} />
              </button>
            </div>
          </div>

          <button className="btn" type="submit" disabled={busy || !email || !password} style={{ marginTop: 8 }}>
            {busy ? <><span className="spin spin-sm" /> Вход…</> : <>Войти <Icon name="arrowRight" size={18} /></>}
          </button>
        </div>

        <div className="login-foot">
          <span className="brandline">
            <BrandMark size={14} color="var(--c-text-faint)" /> pack-men WMS · v{APP_VERSION}
          </span>
        </div>
      </form>
    </div>
  )
}
