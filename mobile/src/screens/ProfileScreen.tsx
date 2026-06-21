import { useAuth } from '../auth/AuthContext'
import { useNav } from '../nav/NavContext'
import { ROLE_LABELS } from '../api/authApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { APP_VERSION } from '../version'

export function ProfileScreen() {
  const { user, logout } = useAuth()
  const { back } = useNav()
  return (
    <div className="screen">
      <AppBar title="Профиль" sub="Учётная запись" onBack={back} noProfile />
      <div className="scroll pad-nav">
        <div className="summary">
          <div className="kv">
            <span className="k">Пользователь</span>
            <span className="v">{user?.email}</span>
          </div>
          <div className="kv">
            <span className="k">Роль</span>
            <span className="v">{user ? ROLE_LABELS[user.role] ?? user.role : ''}</span>
          </div>
          <div className="kv">
            <span className="k">Версия</span>
            <span className="v mono">{APP_VERSION}</span>
          </div>
        </div>

        <button className="btn ghost" style={{ marginTop: 20 }} onClick={() => void logout()}>
          <Icon name="logout" size={18} /> Выйти
        </button>
      </div>
    </div>
  )
}
