import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'

/** Заглушка: ТЗ «Учет товаров» → /inventory */
export function InventoryPage() {
  return (
    <PageContainer maxWidth={520} cardClassName="home-card">
      <Breadcrumbs />
      <p className="auth-card__subtitle">Раздел в разработке</p>
    </PageContainer>
  )
}
