import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <main className="page">
      <section className="auth-card">
        <Outlet />
      </section>
    </main>
  )
}
