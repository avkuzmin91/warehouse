import { useNavigate } from 'react-router-dom'
import { ListPage } from '../layouts/ListPage'
import { Icon } from '../primitives/Icon'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { canManageUsers } from '../../utils/access'

const SECTIONS = [
  { path: '/dictionaries/clients', icon: 'users' as const, title: 'Клиенты', desc: 'Управление клиентами склада' },
  { path: '/dictionaries/products', icon: 'box' as const, title: 'Товары', desc: 'Товары и варианты' },
  { path: '/dictionaries/product-types', icon: 'boxes' as const, title: 'Типы товаров', desc: 'Классификация товаров' },
  { path: '/dictionaries/colors', icon: 'chart' as const, title: 'Цвета', desc: 'Цветовые варианты' },
  { path: '/dictionaries/sizes', icon: 'archive' as const, title: 'Размеры', desc: 'Размерная сетка' },
  { path: '/dictionaries/users', icon: 'users' as const, title: 'Пользователи', desc: 'Учётные записи', usersAdminOnly: true },
]

export function DictionariesListPage() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const sections = SECTIONS.filter((section) => !section.usersAdminOnly || canManageUsers(user))

  return (
    <ListPage title="Справочники" subtitle="Управление данными системы">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, maxWidth: 900 }}>
        {sections.map((s) => (
          <div
            key={s.path}
            className="card"
            style={{ cursor: 'pointer', transition: 'box-shadow 120ms' }}
            onClick={() => navigate(s.path)}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.10)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '')}
          >
            <div className="card-body" style={{ paddingTop: 16, paddingBottom: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <Icon name={s.icon} size={20} style={{ color: 'var(--c-accent)' }} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </ListPage>
  )
}
