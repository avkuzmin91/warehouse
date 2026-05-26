// === Login screen ===

const Login = ({ onLogin }) => {
  const [tab, setTab] = React.useState('signin');
  const [email, setEmail] = React.useState('anna@pack-men.ru');
  const [password, setPassword] = React.useState('••••••••');
  const [showPw, setShowPw] = React.useState(false);
  const [remember, setRemember] = React.useState(true);

  return (
    <div className="auth-page">
      <AuthBackdrop />

      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-card-head">
            <div className="auth-eyebrow">pack-men · WMS</div>
            <h1 className="auth-title">
              {tab === 'signin' ? 'С возвращением' : 'Создать аккаунт'}
            </h1>
            <div className="auth-sub">
              {tab === 'signin' ?
              'Войдите, чтобы продолжить работу со складом' :
              'Аккаунт создаёт администратор склада'}
            </div>
          </div>

          <div className="auth-segmented">
            <button
              onClick={() => setTab('signin')}
              className={`auth-seg ${tab === 'signin' ? 'on' : ''}`}>
              Вход</button>
            <button
              onClick={() => setTab('register')}
              className={`auth-seg ${tab === 'register' ? 'on' : ''}`}>
              Регистрация</button>
          </div>

          <form onSubmit={(e) => {e.preventDefault();onLogin && onLogin();}}>
            <Field label="Рабочий email" required>
              <div style={{ position: 'relative' }}>
                <Icon name="mail" size={14} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--c-text-subtle)' }} />
                <input
                  className="input auth-input"
                  style={{ paddingLeft: 36 }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.ru"
                  autoComplete="email" />
                
              </div>
            </Field>

            <div className="field">
              <label className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Пароль<span style={{ color: 'var(--c-danger)', marginLeft: 3 }}>*</span></span>
                {tab === 'signin' && <a className="auth-link" style={{ fontSize: 11.5, fontWeight: 500 }}>Забыли?</a>}
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
                  autoComplete="current-password" />
                
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="btn ghost icon sm"
                  style={{ position: 'absolute', right: 4, top: 4, height: 30, width: 30 }}
                  title={showPw ? 'Скрыть' : 'Показать'}>
                  
                  <Icon name="eye" size={13} />
                </button>
              </div>
              {tab === 'register' && <div className="help">Содержит цифру и заглавную букву</div>}
            </div>

            {tab === 'signin' &&
            <label className="auth-remember">
                <Checkbox checked={remember} onChange={setRemember} />
                <span>Запомнить меня на этом устройстве</span>
              </label>
            }

            <button
              type="submit"
              className="btn primary auth-submit">
              
              {tab === 'signin' ? 'Войти' : 'Создать аккаунт'}
              <Icon name="arrowRight" size={14} />
            </button>
          </form>

        </div>
      </main>

      <footer className="auth-footer">
        <span style={{ textAlign: "center" }}>© Pack-men, 2026</span>
        <div className="auth-footer-links">
          <a className="auth-link"></a>
          <a className="auth-link"></a>
          <a className="auth-link"></a>
        </div>
      </footer>
    </div>);

};

// Decorative backdrop — soft pac-dot path on warehouse grid, no data
const AuthBackdrop = () =>
<div className="auth-backdrop" aria-hidden="true">
    <svg className="auth-backdrop-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="auth-grid" width="56" height="56" patternUnits="userSpaceOnUse">
          <path d="M 56 0 L 0 0 0 56" fill="none" stroke="var(--c-border)" strokeWidth="1" />
        </pattern>
        <radialGradient id="auth-glow-1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="auth-glow-2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.10" />
          <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="1440" height="900" fill="url(#auth-grid)" opacity="0.6" />
      <circle cx="200" cy="180" r="380" fill="url(#auth-glow-1)" />
      <circle cx="1280" cy="780" r="420" fill="url(#auth-glow-2)" />

      {/* Floating pac dots trail */}
      <g opacity="0.5">
        {Array.from({ length: 18 }).map((_, i) => {
        const x = 120 + i * 80;
        const y = 760 - Math.sin(i * 0.6) * 40;
        const r = 3 + (i % 3 === 0 ? 1.5 : 0);
        return <circle key={i} cx={x} cy={y} r={r} fill="var(--c-accent)" opacity={0.3 + i / 18 * 0.5} />;
      })}
      </g>
      <g opacity="0.4">
        {Array.from({ length: 14 }).map((_, i) => {
        const x = 1320 - i * 80;
        const y = 140 + Math.cos(i * 0.6) * 30;
        return <circle key={i} cx={x} cy={y} r={3} fill="var(--c-accent)" opacity={0.25 + i / 14 * 0.4} />;
      })}
      </g>

      {/* Pac-Man at the left end of the upper trail, chasing the dots */}
      <g transform="translate(160, 140)">
        <path
          d="M 38.95 -15.74 A 42 42 0 1 0 38.95 15.74 L 0 0 Z"
          fill="#3730a3"
          opacity="0.9"
        />
        <circle cx="8" cy="-22" r="4.5" fill="#fafaf9" />
      </g>
    </svg>
  </div>;


window.Login = Login;