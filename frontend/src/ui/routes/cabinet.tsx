import { lazy } from 'react'
import { Route } from 'react-router-dom'

const CabinetDashboardPage = lazy(() =>
  import('../pages/cabinet/CabinetDashboardPage').then((m) => ({ default: m.CabinetDashboardPage })),
)
const CabinetBalancesPage = lazy(() =>
  import('../pages/cabinet/CabinetBalancesPage').then((m) => ({ default: m.CabinetBalancesPage })),
)
const CabinetReceiptsPage = lazy(() =>
  import('../pages/cabinet/CabinetReceiptsPage').then((m) => ({ default: m.CabinetReceiptsPage })),
)
const CabinetReceiptDetailPage = lazy(() =>
  import('../pages/cabinet/CabinetReceiptDetailPage').then((m) => ({ default: m.CabinetReceiptDetailPage })),
)
const CabinetShipmentsPage = lazy(() =>
  import('../pages/cabinet/CabinetShipmentsPage').then((m) => ({ default: m.CabinetShipmentsPage })),
)
const CabinetShipmentDetailPage = lazy(() =>
  import('../pages/cabinet/CabinetShipmentDetailPage').then((m) => ({ default: m.CabinetShipmentDetailPage })),
)
const CabinetDefectsPage = lazy(() =>
  import('../pages/cabinet/CabinetDefectsPage').then((m) => ({ default: m.CabinetDefectsPage })),
)
const CabinetProductsPage = lazy(() =>
  import('../pages/cabinet/CabinetProductsPage').then((m) => ({ default: m.CabinetProductsPage })),
)
const CabinetProductViewPage = lazy(() =>
  import('../pages/cabinet/CabinetProductViewPage').then((m) => ({ default: m.CabinetProductViewPage })),
)
const CabinetReportsPage = lazy(() =>
  import('../pages/cabinet/CabinetReportsPage').then((m) => ({ default: m.CabinetReportsPage })),
)
const CabinetProfilePage = lazy(() =>
  import('../pages/cabinet/CabinetProfilePage').then((m) => ({ default: m.CabinetProfilePage })),
)

export const cabinetRoutes = [
  <Route key="cabinet" path="/cabinet" element={<CabinetDashboardPage />} />,
  <Route key="cabinet-balances" path="/cabinet/balances" element={<CabinetBalancesPage />} />,
  <Route key="cabinet-receipts" path="/cabinet/receipts" element={<CabinetReceiptsPage />} />,
  <Route key="cabinet-receipts-id" path="/cabinet/receipts/:docId" element={<CabinetReceiptDetailPage />} />,
  <Route key="cabinet-shipments" path="/cabinet/shipments" element={<CabinetShipmentsPage />} />,
  <Route key="cabinet-shipments-id" path="/cabinet/shipments/:docId" element={<CabinetShipmentDetailPage />} />,
  <Route key="cabinet-defects" path="/cabinet/defects" element={<CabinetDefectsPage />} />,
  <Route key="cabinet-products" path="/cabinet/products" element={<CabinetProductsPage />} />,
  <Route key="cabinet-products-id" path="/cabinet/products/:id" element={<CabinetProductViewPage />} />,
  <Route key="cabinet-reports" path="/cabinet/reports" element={<CabinetReportsPage />} />,
  <Route key="cabinet-profile" path="/cabinet/profile" element={<CabinetProfilePage />} />,
]
