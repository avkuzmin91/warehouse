import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthTabSync } from './auth/AuthTabSync'
import { RouteLoadingFallback } from './components/RouteLoadingFallback'

const AuthLayout = lazy(() =>
  import('./components/AuthLayout').then((m) => ({ default: m.AuthLayout })),
)
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() =>
  import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
)
const ProtectedLayout = lazy(() =>
  import('./routes/ProtectedLayout').then((m) => ({ default: m.ProtectedLayout })),
)
const AdminRoute = lazy(() =>
  import('./routes/AdminRoute').then((m) => ({ default: m.AdminRoute })),
)
const ManagerAdminRoute = lazy(() =>
  import('./routes/ManagerAdminRoute').then((m) => ({ default: m.ManagerAdminRoute })),
)
const ClientCabinetLayout = lazy(() =>
  import('./routes/ClientCabinetLayout').then((m) => ({ default: m.ClientCabinetLayout })),
)
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })))
const ChangePasswordPage = lazy(() =>
  import('./pages/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })),
)
const ClientCabinetDashboardPage = lazy(() =>
  import('./pages/ClientCabinetDashboardPage').then((m) => ({ default: m.ClientCabinetDashboardPage })),
)
const ClientCabinetBalancesPage = lazy(() =>
  import('./pages/ClientCabinetBalancesPage').then((m) => ({ default: m.ClientCabinetBalancesPage })),
)
const ClientCabinetOperationsPage = lazy(() =>
  import('./pages/ClientCabinetOperationsPage').then((m) => ({ default: m.ClientCabinetOperationsPage })),
)
const ClientCabinetProductsPage = lazy(() =>
  import('./pages/ClientCabinetProductsPage').then((m) => ({ default: m.ClientCabinetProductsPage })),
)
const ClientCabinetProductViewPage = lazy(() =>
  import('./pages/ClientCabinetProductViewPage').then((m) => ({ default: m.ClientCabinetProductViewPage })),
)
const InventoryPage = lazy(() =>
  import('./pages/InventoryPage').then((m) => ({ default: m.InventoryPage })),
)
const InventoryBalancesPage = lazy(() =>
  import('./pages/InventoryBalancesPage').then((m) => ({ default: m.InventoryBalancesPage })),
)
const InventoryOperationsListPage = lazy(() =>
  import('./pages/InventoryOperationsListPage').then((m) => ({ default: m.InventoryOperationsListPage })),
)
const InventoryReceiptPage = lazy(() =>
  import('./pages/InventoryReceiptPage').then((m) => ({ default: m.InventoryReceiptPage })),
)
const InventoryReceiptEditPage = lazy(() =>
  import('./pages/InventoryReceiptEditPage').then((m) => ({ default: m.InventoryReceiptEditPage })),
)
const InventoryShipmentPage = lazy(() =>
  import('./pages/InventoryShipmentPage').then((m) => ({ default: m.InventoryShipmentPage })),
)
const InventoryShipmentEditPage = lazy(() =>
  import('./pages/InventoryShipmentEditPage').then((m) => ({ default: m.InventoryShipmentEditPage })),
)
const ExcelImportPreviewPage = lazy(() =>
  import('./pages/ExcelImportPreviewPage').then((m) => ({ default: m.ExcelImportPreviewPage })),
)
const ExcelImportStep1Page = lazy(() =>
  import('./pages/ExcelImportStep1Page').then((m) => ({ default: m.ExcelImportStep1Page })),
)
const AnalyticsPage = lazy(() =>
  import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
)
const DictionariesListPage = lazy(() =>
  import('./pages/DictionariesListPage').then((m) => ({ default: m.DictionariesListPage })),
)
const DictionariesPage = lazy(() =>
  import('./pages/DictionariesPage').then((m) => ({ default: m.DictionariesPage })),
)
const ClientCreatePage = lazy(() =>
  import('./pages/ClientCreatePage').then((m) => ({ default: m.ClientCreatePage })),
)
const ClientEditPage = lazy(() =>
  import('./pages/ClientEditPage').then((m) => ({ default: m.ClientEditPage })),
)
const ClientsListPage = lazy(() =>
  import('./pages/ClientsListPage').then((m) => ({ default: m.ClientsListPage })),
)
const SizeCreatePage = lazy(() =>
  import('./pages/SizeCreatePage').then((m) => ({ default: m.SizeCreatePage })),
)
const SizeEditPage = lazy(() => import('./pages/SizeEditPage').then((m) => ({ default: m.SizeEditPage })))
const SizesListPage = lazy(() =>
  import('./pages/SizesListPage').then((m) => ({ default: m.SizesListPage })),
)
const SimpleDictionaryListPage = lazy(() =>
  import('./pages/SimpleDictionaryListPage').then((m) => ({ default: m.SimpleDictionaryListPage })),
)
const SimpleDictionaryCreatePage = lazy(() =>
  import('./pages/SimpleDictionaryCreatePage').then((m) => ({ default: m.SimpleDictionaryCreatePage })),
)
const SimpleDictionaryEditPage = lazy(() =>
  import('./pages/SimpleDictionaryEditPage').then((m) => ({ default: m.SimpleDictionaryEditPage })),
)
const ProductCreatePage = lazy(() =>
  import('./pages/ProductCreatePage').then((m) => ({ default: m.ProductCreatePage })),
)
const ProductEditPage = lazy(() =>
  import('./pages/ProductEditPage').then((m) => ({ default: m.ProductEditPage })),
)
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })))

function App() {
  return (
    <>
      <AuthTabSync />
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/auth" replace />} />
          <Route element={<AuthLayout />}>
            <Route path="/auth" element={<LoginPage />} />
            <Route path="/auth/register" element={<RegisterPage />} />
          </Route>
          <Route element={<ProtectedLayout />}>
            <Route path="/home" element={<HomePage />} />
            <Route path="/account/password" element={<ChangePasswordPage />} />
            <Route path="/cabinet" element={<ClientCabinetLayout />}>
              <Route index element={<ClientCabinetDashboardPage />} />
              <Route path="balances" element={<ClientCabinetBalancesPage />} />
              <Route path="receipts" element={<ClientCabinetOperationsPage opType="in" />} />
              <Route path="shipments" element={<ClientCabinetOperationsPage opType="out" />} />
              <Route path="products" element={<ClientCabinetProductsPage />} />
              <Route path="products/:id" element={<ClientCabinetProductViewPage />} />
            </Route>
            <Route
              path="/inventory"
              element={
                <ManagerAdminRoute>
                  <InventoryPage />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/balances"
              element={
                <ManagerAdminRoute>
                  <InventoryBalancesPage />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/receipt"
              element={<Navigate to="/inventory/receipts/new" replace />}
            />
            <Route
              path="/inventory/receipts"
              element={
                <ManagerAdminRoute>
                  <InventoryOperationsListPage opType="in" />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/receipts/new"
              element={
                <ManagerAdminRoute>
                  <InventoryReceiptPage />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/receipts/import/excel/preview"
              element={
                <ManagerAdminRoute>
                  <ExcelImportPreviewPage opType="in" />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/receipts/import/excel"
              element={
                <ManagerAdminRoute>
                  <ExcelImportStep1Page opType="in" />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/receipts/:receiptId"
              element={
                <ManagerAdminRoute>
                  <InventoryReceiptEditPage />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/shipments"
              element={
                <ManagerAdminRoute>
                  <InventoryOperationsListPage opType="out" />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/shipments/new"
              element={
                <ManagerAdminRoute>
                  <InventoryShipmentPage />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/shipments/import/excel/preview"
              element={
                <ManagerAdminRoute>
                  <ExcelImportPreviewPage opType="out" />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/shipments/import/excel"
              element={
                <ManagerAdminRoute>
                  <ExcelImportStep1Page opType="out" />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/inventory/shipments/:shipmentId"
              element={
                <ManagerAdminRoute>
                  <InventoryShipmentEditPage />
                </ManagerAdminRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <AdminRoute>
                  <AnalyticsPage />
                </AdminRoute>
              }
            />
            <Route path="/users" element={<Navigate to="/dictionaries/users" replace />} />
            <Route
              path="/dictionaries/users"
              element={
                <AdminRoute>
                  <UsersPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/products/new"
              element={
                <AdminRoute>
                  <ProductCreatePage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/products/:id"
              element={
                <AdminRoute>
                  <ProductEditPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries"
              element={
                <AdminRoute>
                  <DictionariesListPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/clients"
              element={
                <AdminRoute>
                  <ClientsListPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/clients/new"
              element={
                <AdminRoute>
                  <ClientCreatePage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/clients/:id"
              element={
                <AdminRoute>
                  <ClientEditPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/sizes"
              element={
                <AdminRoute>
                  <SizesListPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/sizes/new"
              element={
                <AdminRoute>
                  <SizeCreatePage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/sizes/:id"
              element={
                <AdminRoute>
                  <SizeEditPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/colors"
              element={
                <AdminRoute>
                  <SimpleDictionaryListPage entity="colors" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/colors/new"
              element={
                <AdminRoute>
                  <SimpleDictionaryCreatePage entity="colors" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/colors/:id"
              element={
                <AdminRoute>
                  <SimpleDictionaryEditPage entity="colors" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/product-types"
              element={
                <AdminRoute>
                  <SimpleDictionaryListPage entity="product-types" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/product-types/new"
              element={
                <AdminRoute>
                  <SimpleDictionaryCreatePage entity="product-types" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/product-types/:id"
              element={
                <AdminRoute>
                  <SimpleDictionaryEditPage entity="product-types" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/suppliers"
              element={
                <AdminRoute>
                  <SimpleDictionaryListPage entity="suppliers" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/suppliers/new"
              element={
                <AdminRoute>
                  <SimpleDictionaryCreatePage entity="suppliers" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/suppliers/:id"
              element={
                <AdminRoute>
                  <SimpleDictionaryEditPage entity="suppliers" />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/:section"
              element={
                <AdminRoute>
                  <DictionariesPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/:section/new"
              element={
                <AdminRoute>
                  <DictionariesPage />
                </AdminRoute>
              }
            />
            <Route
              path="/dictionaries/:section/:itemId"
              element={
                <AdminRoute>
                  <DictionariesPage />
                </AdminRoute>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}

export default App
