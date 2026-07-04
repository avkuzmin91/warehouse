import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../primitives/Icon'
import { Kbd } from '../primitives/Kbd'
import { Breadcrumbs } from './Breadcrumbs'
import { buildBreadcrumbsFromPathname } from '../../utils/breadcrumbLabels'

interface TopbarProps {
  onCmd: () => void
  onToggleSidebar?: () => void
  sidebarCollapsed?: boolean
}

export function Topbar({ onCmd, onToggleSidebar, sidebarCollapsed }: TopbarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const path = location.pathname

  const crumbs = buildBreadcrumbsFromPathname(path)

  return (
    <header className="topbar">
      {sidebarCollapsed && onToggleSidebar && (
        <button className="btn ghost icon" onClick={onToggleSidebar} title="Развернуть меню" style={{ marginRight: 4 }}>
          <Icon name="menu" size={15} />
        </button>
      )}
      {crumbs.length > 0 && <Breadcrumbs crumbs={crumbs} onNavigate={navigate} />}
      {path.startsWith('/cabinet') && (
        <span
          className="beta-pill"
          title="Кабинет клиента работает в режиме беты: мы активно его дорабатываем. Если что-то выглядит не так — напишите вашему менеджеру."
        >
          Beta
        </span>
      )}
      <div className="topbar-spacer" />
      <div className="topbar-search" onClick={onCmd}>
        <Icon name="search" size={14} />
        <span style={{ flex: 1 }}>Найти, выполнить…</span>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </div>
      <button className="btn icon ghost" title="Уведомления">
        <Icon name="bell" size={15} />
      </button>
    </header>
  )
}
