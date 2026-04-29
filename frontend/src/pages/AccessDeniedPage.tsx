import { Breadcrumbs } from '../components/Breadcrumbs'

export function AccessDeniedPage() {
  return (
    <main className="page page--center">
      <section className="auth-card dict-hub-card">
        <Breadcrumbs />
        <p className="auth-card__subtitle">Доступ запрещён. Недостаточно прав. (403)</p>
      </section>
    </main>
  )
}
