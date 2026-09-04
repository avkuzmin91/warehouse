import { useRef, useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Brand } from '../primitives/Brand'
import { Icon } from '../primitives/Icon'
import { Avatar, getInitials } from '../primitives/Avatar'
import { authLogout } from '../../api/sessionAuth'
import type { IconName } from '../primitives/Icon'
import type { User } from '../../api/typesUser'
import { canManageUsers, canManageTimesheet, canViewPayroll } from '../../utils/access'

interface NavItem {
  to: string
  icon: IconName
  label: string
  count?: number
}

const OPS_NAV: NavItem[] = [
  { to: '/home', icon: 'home', label: 'Главная' },
  { to: '/inventory/receipts', icon: 'dolly', label: 'Поступления' },
  { to: '/inventory/packing', icon: 'box', label: 'Упаковка' },
  { to: '/inventory/boxes', icon: 'archive', label: 'Короба' },
  { to: '/inventory/dispatches', icon: 'forklift', label: 'Отгрузки' },
  { to: '/logistics/trips', icon: 'truckIn', label: 'Логистика' },
  { to: '/inventory/balances', icon: 'boxes', label: 'Остатки' },
]

const FINANCE_NAV: NavItem[] = [
  { to: '/finance/invoices', icon: 'ruble', label: 'Счета' },
  { to: '/finance/extra-income', icon: 'briefcase', label: 'Доп. работы' },
  { to: '/finance/expenses', icon: 'coins', label: 'Расходы' },
  { to: '/finance/recurring', icon: 'refresh', label: 'Регулярные расходы' },
  { to: '/finance/storage', icon: 'archive', label: 'Хранение' },
]

const MARKETPLACES_NAV: NavItem[] = [
  { to: '/marketplaces/supplies', icon: 'truckOut', label: 'Отгрузки FBS' },
  { to: '/marketplaces/orders', icon: 'cart', label: 'FBS-заказы' },
  { to: '/marketplaces/links', icon: 'tag', label: 'Связка товаров' },
  { to: '/marketplaces/accounts', icon: 'settings', label: 'Подключения' },
]

const TIMESHEET_NAV: NavItem[] = [
  { to: '/timesheet', icon: 'clock', label: 'Табель' },
  { to: '/timesheet/planning', icon: 'calendar', label: 'Планирование' },
  { to: '/timesheet/payroll', icon: 'wallet', label: 'Выплаты' },
  { to: '/timesheet/employees', icon: 'users', label: 'Сотрудники' },
  { to: '/timesheet/calendar', icon: 'calendar', label: 'Производственный календарь' },
]

const SHIFT_SUPERVISOR_NAV: NavItem[] = [
  { to: '/home', icon: 'home', label: 'Главная' },
  { to: '/inventory/packing', icon: 'box', label: 'Упаковка' },
  { to: '/inventory/boxes', icon: 'archive', label: 'Короба' },
]

// Аналитика расходов включает ЗП и аренду (admin-only данные) и гейтится по
// финансовому доступу (admin/manager), а не по общему «управлению».
const ANALYTICS_NAV: NavItem[] = [
  { to: '/analytics', icon: 'chart', label: 'Аналитика' },
]

const ADMIN_NAV: NavItem[] = [
  { to: '/dictionaries', icon: 'book', label: 'Справочники' },
]

const USERS_NAV: NavItem[] = [
  { to: '/dictionaries/users', icon: 'users', label: 'Пользователи' },
]

const CLIENT_NAV: NavItem[] = [
  { to: '/cabinet', icon: 'home', label: 'Сводка' },
  { to: '/cabinet/balances', icon: 'boxes', label: 'Остатки' },
  { to: '/cabinet/receipts', icon: 'dolly', label: 'Поступления' },
  { to: '/cabinet/shipments', icon: 'boxOut', label: 'Отгрузки' },
  { to: '/cabinet/defects', icon: 'alert', label: 'Брак' },
  { to: '/cabinet/products', icon: 'box', label: 'Мои товары' },
  { to: '/cabinet/reports', icon: 'chart', label: 'Отчёты' },
  { to: '/cabinet/profile', icon: 'building', label: 'Профиль и магазины' },
]

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  user: 'Без доступа',
  warehouse_manager: 'Кладовщик',
  shift_supervisor: 'Начальник смены',
  warehouse_head: 'Начальник склада',
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
  const isShiftSupervisor = user?.role === 'shift_supervisor'
  const hasStaffAccess = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
  const hasAdminAccess = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
  const hasFinanceAccess = user?.role === 'admin' || user?.role === 'manager'
  const hasTimesheetAccess = canManageTimesheet(user)
  const canSeePayroll = canViewPayroll(user)

  const displayName = user?.display_name?.trim()
    ? user.display_name.trim()
    : user?.email
      ? user.email.split('@')[0]
      : 'Пользователь'
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
            <div className="sidebar-brand-text">Pack-Men</div>
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

      <nav className="sidebar-nav">
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
            {isShiftSupervisor && SHIFT_SUPERVISOR_NAV.map((item) => (
              <NavItem key={item.to} {...item} collapsed={collapsed} />
            ))}
            {hasStaffAccess && OPS_NAV.map((item) => (
              <NavItem key={item.to} {...item} collapsed={collapsed} />
            ))}
            {hasFinanceAccess && (
              <>
                {!collapsed && <div className="sidebar-section">Финансы</div>}
                {FINANCE_NAV.map((item) => (
                  <NavItem key={item.to} {...item} collapsed={collapsed} />
                ))}
              </>
            )}
            {hasFinanceAccess && (
              <>
                {!collapsed && <div className="sidebar-section">Маркетплейсы</div>}
                {MARKETPLACES_NAV.map((item) => (
                  <NavItem key={item.to} {...item} collapsed={collapsed} />
                ))}
              </>
            )}
            {hasTimesheetAccess && (
              <>
                {!collapsed && <div className="sidebar-section">Табель</div>}
                {TIMESHEET_NAV
                  .filter((item) => item.to !== '/timesheet/payroll' || canSeePayroll)
                  .map((item) => (
                    <NavItem key={item.to} {...item} collapsed={collapsed} />
                  ))}
              </>
            )}
            {hasAdminAccess && (
              <>
                {!collapsed && <div className="sidebar-section">Управление</div>}
                {[...(hasFinanceAccess ? ANALYTICS_NAV : []), ...ADMIN_NAV, ...(canManageUsers(user) ? USERS_NAV : [])].map((item) => (
                  <NavItem key={item.to} {...item} collapsed={collapsed} />
                ))}
              </>
            )}
          </>
        )}
      </nav>

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
