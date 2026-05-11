import { Outlet } from 'react-router-dom'
import { AppFooter } from './AppFooter'

export function AuthLayout() {
  return (
    <div className="auth-shell">
      <main className="page">
        <section className="auth-card">
          <Outlet />
        </section>
      </main>
      <AppFooter />
    </div>
  )
}
