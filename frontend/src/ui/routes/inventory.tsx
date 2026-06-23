import { lazy } from 'react'
import { Navigate, Route } from 'react-router-dom'

const InventoryHomePage = lazy(() =>
  import('../pages/InventoryHomePage').then((m) => ({ default: m.InventoryHomePage })),
)
const InventoryReceiptsListPage = lazy(() =>
  import('../pages/InventoryReceiptsListPage').then((m) => ({ default: m.InventoryReceiptsListPage })),
)
const InventoryReceiptPage = lazy(() =>
  import('../pages/InventoryReceiptPage').then((m) => ({ default: m.InventoryReceiptPage })),
)
const InventoryReceiptDetailPage = lazy(() =>
  import('../pages/InventoryReceiptDetailPage').then((m) => ({ default: m.InventoryReceiptDetailPage })),
)
const InventoryBalancesPage = lazy(() =>
  import('../pages/InventoryBalancesPage').then((m) => ({ default: m.InventoryBalancesPage })),
)
const InventoryShipmentCreatePage = lazy(() =>
  import('../pages/InventoryShipmentCreatePage').then((m) => ({ default: m.InventoryShipmentCreatePage })),
)
const InventoryShipmentDetailPage = lazy(() =>
  import('../pages/InventoryShipmentDetailPage').then((m) => ({ default: m.InventoryShipmentDetailPage })),
)
const InventoryPackingPage = lazy(() =>
  import('../pages/InventoryPackingPage').then((m) => ({ default: m.InventoryPackingPage })),
)
const InventoryPackingProductivityPage = lazy(() =>
  import('../pages/InventoryPackingProductivityPage').then((m) => ({ default: m.InventoryPackingProductivityPage })),
)
const InventoryDispatchesListPage = lazy(() =>
  import('../pages/InventoryDispatchesListPage').then((m) => ({ default: m.InventoryDispatchesListPage })),
)
const InventoryDispatchCreatePage = lazy(() =>
  import('../pages/InventoryDispatchCreatePage').then((m) => ({ default: m.InventoryDispatchCreatePage })),
)
const InventoryDispatchDetailPage = lazy(() =>
  import('../pages/InventoryDispatchDetailPage').then((m) => ({ default: m.InventoryDispatchDetailPage })),
)
export const inventoryRoutes = [
  <Route key="inventory-home" path="/inventory" element={<InventoryHomePage />} />,
  <Route key="inventory-balances" path="/inventory/balances" element={<InventoryBalancesPage />} />,

  <Route key="inventory-receipts" path="/inventory/receipts" element={<InventoryReceiptsListPage />} />,
  <Route key="inventory-receipts-new" path="/inventory/receipts/new" element={<InventoryReceiptPage />} />,
  <Route key="inventory-receipts-id" path="/inventory/receipts/:docId" element={<InventoryReceiptDetailPage />} />,

  <Route key="inventory-shipments" path="/inventory/shipments" element={<Navigate to="/inventory/packing" replace />} />,
  <Route key="inventory-shipments-new" path="/inventory/shipments/new" element={<InventoryShipmentCreatePage />} />,
  <Route key="inventory-shipments-id" path="/inventory/shipments/:docId" element={<InventoryShipmentDetailPage />} />,

  <Route key="inventory-dispatches" path="/inventory/dispatches" element={<InventoryDispatchesListPage />} />,
  <Route key="inventory-dispatches-new" path="/inventory/dispatches/new" element={<InventoryDispatchCreatePage />} />,
  <Route key="inventory-dispatches-id" path="/inventory/dispatches/:docId" element={<InventoryDispatchDetailPage />} />,

  <Route key="inventory-packing" path="/inventory/packing" element={<InventoryPackingPage />} />,
  <Route key="inventory-packing-productivity" path="/inventory/packing/productivity" element={<InventoryPackingProductivityPage />} />,
]
