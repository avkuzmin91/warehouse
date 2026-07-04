import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useNav } from '../nav/NavContext'
import { ROLE_LABELS } from '../api/authApi'
import { AppBar } from '../components/AppBar'
import { Icon } from '../components/Icon'
import { APP_VERSION } from '../version'
import { isScanAutoStartEnabled, setScanAutoStartEnabled } from '../utils/scanSettings'

export function ProfileScreen() {
  const { user, logout } = useAuth()
  const { back } = useNav()
  const [autoScan, setAutoScan] = useState(isScanAutoStartEnabled)

  function toggleAutoScan() {
    const next = !autoScan
    setScanAutoStartEnabled(next)
    setAutoScan(next)
  }

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

        <div className="sec">Настройки</div>
        <div className="tile static">
          <div className="tile-body">
            <div className="tile-title">Автозапуск сканера</div>
            <div className="tile-meta">Камера открывается сразу при входе на экран скана</div>
          </div>
          <button
            type="button"
            className={`switch${autoScan ? ' on' : ''}`}
            role="switch"
            aria-checked={autoScan}
            aria-label="Автозапуск сканера"
            onClick={toggleAutoScan}
          />
        </div>

        <button className="btn ghost" style={{ marginTop: 20 }} onClick={() => void logout()}>
          <Icon name="logout" size={18} /> Выйти
        </button>
      </div>
    </div>
  )
}
