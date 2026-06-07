import { useLocation } from 'react-router-dom'
import { Icon } from '../primitives/Icon'
import { Kbd } from '../primitives/Kbd'

const ROUTE_LABELS: Record<string, string[]> = {
  '/home': ['Главная'],
  '/inventory': ['Склад'],
  '/inventory/receipts': ['Склад', 'Поступления'],
  '/inventory/receipts/new': ['Склад', 'Поступления', 'Новое'],
  '/inventory/shipments': ['Склад', 'Отгрузки'],
  '/inventory/shipments/new': ['Склад', 'Отгрузки', 'Новая'],
  '/inventory/balances': ['Склад', 'Остатки'],
  '/inventory/packing': ['Склад', 'Упаковка'],
  '/analytics': ['Аналитика'],
  '/dictionaries': ['Справочники'],
  '/dictionaries/users': ['Управление', 'Пользователи'],
  '/dictionaries/clients': ['Справочники', 'Клиенты'],
  '/dictionaries/sizes': ['Справочники', 'Размеры'],
  '/dictionaries/colors': ['Справочники', 'Цвета'],
  '/dictionaries/product-types': ['Справочники', 'Типы'],
  '/dictionaries/suppliers': ['Справочники', 'Поставщики'],
  '/account/password': ['Аккаунт', 'Смена пароля'],
  '/cabinet': ['Личный кабинет'],
  '/cabinet/balances': ['Личный кабинет', 'Остатки'],
  '/cabinet/receipts': ['Личный кабинет', 'Поступления'],
  '/cabinet/shipments': ['Личный кабинет', 'Отгрузки'],
  '/cabinet/products': ['Личный кабинет', 'Товары'],
}

interface TopbarProps {
  onCmd: () => void
  onToggleSidebar?: () => void
  sidebarCollapsed?: boolean
}

export function Topbar({ onCmd, onToggleSidebar, sidebarCollapsed }: TopbarProps) {
  const location = useLocation()
  const path = location.pathname

  const crumbs = (() => {
    if (ROUTE_LABELS[path]) return ROUTE_LABELS[path]
    for (const [key, val] of Object.entries(ROUTE_LABELS)) {
      if (path.startsWith(key + '/')) return [...val, '…']
    }
    return []
  })()

  return (
    <header className="topbar">
      {sidebarCollapsed && onToggleSidebar && (
        <button className="btn ghost icon" onClick={onToggleSidebar} title="Развернуть меню" style={{ marginRight: 4 }}>
          <Icon name="menu" size={15} />
        </button>
      )}
      {crumbs.length > 0 && (
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <span className="sep">/</span>}
              <span className={`crumb ${i === crumbs.length - 1 ? 'active' : ''}`}>{c}</span>
            </span>
          ))}
        </div>
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
