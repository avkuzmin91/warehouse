import { Link } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'

const NAV = [
  { key: 'receipts', label: 'Поступления', to: '/inventory/receipts' },
  { key: 'shipments', label: 'Отгрузки', to: '/inventory/shipments' },
  { key: 'balances', label: 'Остатки', to: '/inventory/balances' },
] as const

export function InventoryPage() {
  return (
    <PageContainer maxWidth={520} cardClassName="home-card">
      <Breadcrumbs />
      <ul className="home-nav" role="list">
        {NAV.map((item) => (
          <li key={item.key} className="home-nav__item">
            <Link className="home-nav__link" to={item.to}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  )
}
