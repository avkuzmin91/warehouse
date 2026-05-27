import { lazy } from 'react'
import { Route } from 'react-router-dom'

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
const InventoryShipmentsListPage = lazy(() =>
  import('../pages/InventoryShipmentsListPage').then((m) => ({ default: m.InventoryShipmentsListPage })),
)
const InventoryShipmentCreatePage = lazy(() =>
  import('../pages/InventoryShipmentCreatePage').then((m) => ({ default: m.InventoryShipmentCreatePage })),
)
const InventoryShipmentDetailPage = lazy(() =>
  import('../pages/InventoryShipmentDetailPage').then((m) => ({ default: m.InventoryShipmentDetailPage })),
)
const ExcelImportStep1Page = lazy(() =>
  import('../pages/ExcelImportStep1Page').then((m) => ({ default: m.ExcelImportStep1Page })),
)
const ExcelImportPreviewPage = lazy(() =>
  import('../pages/ExcelImportPreviewPage').then((m) => ({ default: m.ExcelImportPreviewPage })),
)

export const inventoryRoutes = [
  <Route key="inventory-home" path="/inventory" element={<InventoryHomePage />} />,
  <Route key="inventory-balances" path="/inventory/balances" element={<InventoryBalancesPage />} />,

  <Route key="inventory-receipts" path="/inventory/receipts" element={<InventoryReceiptsListPage />} />,
  <Route key="inventory-receipts-new" path="/inventory/receipts/new" element={<InventoryReceiptPage />} />,
  <Route key="inventory-receipts-import-excel-preview" path="/inventory/receipts/import/excel/preview" element={<ExcelImportPreviewPage opType="in" />} />,
  <Route key="inventory-receipts-import-excel" path="/inventory/receipts/import/excel" element={<ExcelImportStep1Page opType="in" />} />,
  <Route key="inventory-receipts-id" path="/inventory/receipts/:docId" element={<InventoryReceiptDetailPage />} />,

  <Route key="inventory-shipments" path="/inventory/shipments" element={<InventoryShipmentsListPage />} />,
  <Route key="inventory-shipments-new" path="/inventory/shipments/new" element={<InventoryShipmentCreatePage />} />,
  <Route key="inventory-shipments-import-excel-preview" path="/inventory/shipments/import/excel/preview" element={<ExcelImportPreviewPage opType="out" />} />,
  <Route key="inventory-shipments-import-excel" path="/inventory/shipments/import/excel" element={<ExcelImportStep1Page opType="out" />} />,
  <Route key="inventory-shipments-id" path="/inventory/shipments/:docId" element={<InventoryShipmentDetailPage />} />,
]
