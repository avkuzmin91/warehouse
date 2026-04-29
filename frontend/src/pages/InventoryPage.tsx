import { Breadcrumbs } from '../components/Breadcrumbs'

/** Заглушка: ТЗ «Учет товаров» → /inventory */
export function InventoryPage() {
  return (
    <main className="page page--center">
      <section className="auth-card home-card">
        <Breadcrumbs />
        <p className="auth-card__subtitle">Раздел в разработке</p>
      </section>
    </main>
  )
}
