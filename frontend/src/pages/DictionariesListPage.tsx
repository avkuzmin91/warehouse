import { Link } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'

const entries: { label: string; to: string }[] = [
  { label: 'Пользователи', to: '/users' },
  { label: 'Товары', to: '/dictionaries/products' },
  { label: 'Клиенты', to: '/dictionaries/clients' },
  { label: 'Размеры', to: '/dictionaries/sizes' },
  { label: 'Цвета', to: '/dictionaries/colors' },
]

export function DictionariesListPage() {
  return (
    <main className="page page--center">
      <section className="auth-card dict-hub-card">
        <Breadcrumbs />

        <ul className="dict-hub-list">
          {entries.map((item) => (
            <li key={item.to} className="dict-hub-list__item">
              <Link className="dict-hub-list__link" to={item.to}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
