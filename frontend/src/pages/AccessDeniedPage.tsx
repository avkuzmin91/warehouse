import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'

export function AccessDeniedPage() {
  return (
    <PageContainer maxWidth={520} cardClassName="dict-hub-card">
      <Breadcrumbs />
      <p className="auth-card__subtitle">Доступ запрещён</p>
      <p className="field-hint" style={{ marginTop: 8 }}>
        Раздел доступен только администратору.
      </p>
    </PageContainer>
  )
}
