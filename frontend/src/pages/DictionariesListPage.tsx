import { Link, useNavigate } from 'react-router-dom'

const entries: { label: string; to: string }[] = [
  { label: 'Пользователи', to: '/users' },
  { label: 'Товары', to: '/dictionaries/products' },
  { label: 'Клиенты', to: '/dictionaries/clients' },
  { label: 'Размеры', to: '/dictionaries/sizes' },
  { label: 'Цвета', to: '/dictionaries/colors' },
]

export function DictionariesListPage() {
  const navigate = useNavigate()

  return (
    <main className="page page--center">
      <section className="auth-card dict-hub-card">
        <nav className="dict-breadcrumbs" aria-label="Навигация по ссылкам">
          <Link className="dict-breadcrumbs__link" to="/dashboard">
            Главная
          </Link>
          <span className="dict-breadcrumbs__sep" aria-hidden>
            {' '}
            /{' '}
          </span>
          <span className="dict-breadcrumbs__current">Справочники</span>
        </nav>

        <h1 className="auth-card__title dict-hub__title">Справочники</h1>

        <ul className="dict-hub-list">
          {entries.map((item) => (
            <li key={item.to} className="dict-hub-list__item">
              <Link className="dict-hub-list__link" to={item.to}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="dict-hub-actions">
          <button className="btn btn--secondary" type="button" onClick={() => navigate(-1)}>
            Назад
          </button>
        </div>
      </section>
    </main>
  )
}
