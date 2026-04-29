import { Outlet } from 'react-router-dom'
import { Header } from './Header'

export function AppLayout() {
  return (
    <div className="app-shell">
      <Header />
      <div className="app-shell__outlet">
        <Outlet />
      </div>
    </div>
  )
}
