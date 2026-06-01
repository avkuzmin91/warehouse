import { useRef, useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Brand } from '../primitives/Brand'
import { Icon } from '../primitives/Icon'
import { Avatar, getInitials } from '../primitives/Avatar'
import { authLogout } from '../../api/sessionAuth'
import type { IconName } from '../primitives/Icon'
import type { User } from '../../api/typesUser'

interface NavItem {
  to: string
  icon: IconName
  label: string
  count?: number
}

const OPS_NAV: NavItem[] = [
  { to: '/home', icon: 'home', label: 'Главная' },
  { to: '/inventory/receipts', icon: 'truckIn', label: 'Поступления' },
  { to: '/inventory/shipments', icon: 'truckOut', label: 'Отгрузки' },
  { to: '/inventory/balances', icon: 'boxes', label: 'Остатки' },
]

const ADMIN_NAV: NavItem[] = [
  { to: '/analytics', icon: 'chart', label: 'Аналитика' },
  { to: '/dictionaries', icon: 'book', label: 'Справочники' },
  { to: '/dictionaries/users', icon: 'users', label: 'Пользователи' },
]

const CLIENT_NAV: NavItem[] = [
  { to: '/cabinet', icon: 'home', label: 'Обзор' },
  { to: '/cabinet/balances', icon: 'boxes', label: 'Мои остатки' },
  { to: '/cabinet/receipts', icon: 'truckIn', label: 'Поступления' },
  { to: '/cabinet/shipments', icon: 'truckOut', label: 'Отгрузки' },
  { to: '/cabinet/products', icon: 'box', label: 'Товары' },
]

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  user: 'Без доступа',
  warehouse_manager: 'Кладовщик',
  client: 'Клиент',
}

interface SidebarProps {
  user: User | null
  collapsed?: boolean
  onToggle?: () => void
  onLogout?: () => void
}

export function Sidebar({ user, collapsed = false, onToggle }: SidebarProps) {
  const navigate = useNavigate()
  const isClient = user?.role === 'client'
  const hasStaffAccess = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager'
  const hasAdminAccess = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager'

  const displayName = user?.email ? user.email.split('@')[0] : 'Пользователь'
  const initials = getInitials(displayName)

  const [menuOpen, setMenuOpen] = useState(false)
  const footerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (footerRef.current && !footerRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const handleChangePassword = () => {
    setMenuOpen(false)
    navigate('/account/password')
  }

  const handleLogout = async () => {
    setMenuOpen(false)
    await authLogout()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Brand size={22} />
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-brand-text">Pack-men</div>
            <div className="sidebar-brand-sub">
              {isClient ? 'Кабинет клиента' : 'WMS'}
            </div>
          </div>
        )}
        <button
          className="btn ghost icon sm sidebar-collapse-btn"
          onClick={onToggle}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          style={{ marginLeft: collapsed ? 'auto' : undefined, marginRight: collapsed ? 'auto' : undefined }}
        >
          <Icon name={collapsed ? 'arrowRight' : 'arrowLeft'} size={14} />
        </button>
      </div>

      {isClient ? (
        <>
          {!collapsed && <div className="sidebar-section">Личный кабинет</div>}
          {CLIENT_NAV.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}
        </>
      ) : (
        <>
          {!collapsed && <div className="sidebar-section">Склад</div>}
          {hasStaffAccess && OPS_NAV.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}
          {hasAdminAccess && (
            <>
              {!collapsed && <div className="sidebar-section">Управление</div>}
              {ADMIN_NAV.map((item) => (
                <NavItem key={item.to} {...item} collapsed={collapsed} />
              ))}
            </>
          )}
        </>
      )}

      <div className="sidebar-footer-wrap" ref={footerRef}>
        {menuOpen && (
          <div className="account-menu">
            <button className="account-menu-item" onClick={handleChangePassword}>
              <Icon name="lock" size={14} />
              {!collapsed && 'Сменить пароль'}
            </button>
            <button className="account-menu-item account-menu-item--danger" onClick={handleLogout}>
              <Icon name="logout" size={14} />
              {!collapsed && 'Выйти из аккаунта'}
            </button>
          </div>
        )}
        <div
          className="sidebar-footer"
          onClick={() => setMenuOpen((v) => !v)}
          title={collapsed ? displayName : undefined}
        >
          <Avatar initials={initials} />
          {!collapsed && (
            <>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {displayName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                  {ROLE_LABELS[user?.role ?? ''] ?? user?.role}
                </div>
              </div>
              <Icon name="chev" size={14} style={{ color: 'var(--c-text-subtle)', transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

function NavItem({ to, icon, label, count, collapsed }: NavItem & { collapsed?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''} ${collapsed ? 'nav-item--collapsed' : ''}`}
      style={{ textDecoration: 'none' }}
      title={collapsed ? label : undefined}
    >
      <Icon name={icon} className="nav-icon" />
      {!collapsed && <span>{label}</span>}
      {!collapsed && count != null && count > 0 && (
        <span className="nav-count">{count}</span>
      )}
    </NavLink>
  )
}
