import { lazy } from 'react'
import { Route } from 'react-router-dom'

const CabinetDashboardPage = lazy(() =>
  import('../pages/cabinet/CabinetDashboardPage').then((m) => ({ default: m.CabinetDashboardPage })),
)
const CabinetBalancesPage = lazy(() =>
  import('../pages/cabinet/CabinetBalancesPage').then((m) => ({ default: m.CabinetBalancesPage })),
)
const CabinetOperationsPage = lazy(() =>
  import('../pages/cabinet/CabinetOperationsPage').then((m) => ({ default: m.CabinetOperationsPage })),
)
const CabinetProductsPage = lazy(() =>
  import('../pages/cabinet/CabinetProductsPage').then((m) => ({ default: m.CabinetProductsPage })),
)
const CabinetProductViewPage = lazy(() =>
  import('../pages/cabinet/CabinetProductViewPage').then((m) => ({ default: m.CabinetProductViewPage })),
)

export const cabinetRoutes = [
  <Route key="cabinet" path="/cabinet" element={<CabinetDashboardPage />} />,
  <Route key="cabinet-balances" path="/cabinet/balances" element={<CabinetBalancesPage />} />,
  <Route key="cabinet-receipts" path="/cabinet/receipts" element={<CabinetOperationsPage opType="in" />} />,
  <Route key="cabinet-shipments" path="/cabinet/shipments" element={<CabinetOperationsPage opType="out" />} />,
  <Route key="cabinet-products" path="/cabinet/products" element={<CabinetProductsPage />} />,
  <Route key="cabinet-products-id" path="/cabinet/products/:id" element={<CabinetProductViewPage />} />,
]
