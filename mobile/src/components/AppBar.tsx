import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useNav } from '../nav/NavContext'
import { Icon } from './Icon'

function initials(email?: string): string {
  if (!email) return '—'
  const name = email.split('@')[0]
  const parts = name.split(/[._-]+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}

// Шапка экрана в стиле редизайна: опц. кнопка «назад», заголовок + подзаголовок,
// и справа — аватар-инициалы, открывающий профиль. На самом экране профиля и на
// скане ШК кнопка профиля не нужна — `noProfile` её прячет.
export function AppBar({
  title,
  sub,
  onBack,
  bordered,
  noProfile,
}: {
  title: ReactNode
  sub?: ReactNode
  onBack?: () => void
  bordered?: boolean
  noProfile?: boolean
}) {
  const { user } = useAuth()
  const { openProfile } = useNav()
  return (
    <div className={`appbar${bordered ? ' bordered' : ''}`}>
      {onBack && (
        <button className="appbar-back" aria-label="Назад" onClick={onBack}>
          <Icon name="arrowLeft" size={19} />
        </button>
      )}
      <div className="appbar-titles">
        <h1>{title}</h1>
        {sub != null && sub !== '' && <div className="sub">{sub}</div>}
      </div>
      {!noProfile && (
        <button className="appbar-avatar" aria-label="Профиль" onClick={openProfile}>
          {initials(user?.email)}
        </button>
      )}
    </div>
  )
}
