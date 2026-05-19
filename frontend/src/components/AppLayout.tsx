import { Outlet } from 'react-router-dom'
import { AppFooter } from './AppFooter'
import { Header } from './Header'
/** Формы склада / товара / приёмка-отгрузка (вынесено из App.css). */
import './InventoryProductStyles.css'

export function AppLayout() {
  return (
    <div className="app-shell">
      <Header />
      <div className="app-shell__outlet app-shell__outlet--flex">
        <div className="app-shell__outlet-inner">
          <Outlet />
        </div>
        <AppFooter />
      </div>
    </div>
  )
}
