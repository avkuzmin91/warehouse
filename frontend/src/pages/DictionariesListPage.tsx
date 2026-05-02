import { Link } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'

const entries: { label: string; to: string }[] = [
  { label: 'Пользователи', to: '/users' },
  { label: 'Товары', to: '/dictionaries/products' },
  { label: 'Клиенты', to: '/dictionaries/clients' },
  { label: 'Типы товаров', to: '/dictionaries/product-types' },
  { label: 'Поставщики', to: '/dictionaries/suppliers' },
  { label: 'Размеры', to: '/dictionaries/sizes' },
  { label: 'Цвета', to: '/dictionaries/colors' },
]

export function DictionariesListPage() {
  return (
    <PageContainer maxWidth={520} cardClassName="dict-hub-card">
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
    </PageContainer>
  )
}
