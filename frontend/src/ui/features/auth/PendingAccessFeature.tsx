import { authLogout } from '../../../api/sessionAuth'
import { Brand } from '../../primitives/Brand'

interface PendingAccessFeatureProps {
  email?: string | null
}

export function PendingAccessFeature({ email }: PendingAccessFeatureProps) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--c-bg)',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--c-bg-elev)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-2)',
          padding: 28,
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <Brand size={42} />
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: 0 }}>
          Доступ отключён
        </h1>
        <p style={{ margin: '10px 0 0', color: 'var(--c-text-muted)', lineHeight: 1.55 }}>
          Для этого аккаунта не назначена рабочая роль. Обратитесь к администратору или менеджеру,
          если доступ нужно вернуть.
        </p>
        {email && (
          <div
            className="mono"
            style={{
              marginTop: 18,
              color: 'var(--c-text-subtle)',
              fontSize: 12,
              overflowWrap: 'anywhere',
            }}
          >
            {email}
          </div>
        )}
        <div style={{ marginTop: 22 }}>
          <button className="btn" onClick={() => authLogout()}>
            Выйти
          </button>
        </div>
      </section>
    </div>
  )
}
