import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'

export function AccessDeniedPage() {
  return (
    <PageContainer maxWidth={520} cardClassName="dict-hub-card">
      <Breadcrumbs />
      <p className="auth-card__subtitle">Доступ запрещён. Недостаточно прав. (403)</p>
    </PageContainer>
  )
}
