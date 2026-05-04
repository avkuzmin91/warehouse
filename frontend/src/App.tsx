import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthLayout } from './components/AuthLayout'
import { HomePage } from './pages/HomePage'
import { InventoryPage } from './pages/InventoryPage'
import { InventoryBalancesPage } from './pages/InventoryBalancesPage'
import { InventoryOperationsListPage } from './pages/InventoryOperationsListPage'
import { InventoryReceiptPage } from './pages/InventoryReceiptPage'
import { InventoryReceiptEditPage } from './pages/InventoryReceiptEditPage'
import { InventoryShipmentPage } from './pages/InventoryShipmentPage'
import { InventoryShipmentEditPage } from './pages/InventoryShipmentEditPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { DictionariesListPage } from './pages/DictionariesListPage'
import { DictionariesPage } from './pages/DictionariesPage'
import { ClientCreatePage } from './pages/ClientCreatePage'
import { ClientEditPage } from './pages/ClientEditPage'
import { ClientsListPage } from './pages/ClientsListPage'
import { SizeCreatePage } from './pages/SizeCreatePage'
import { SizeEditPage } from './pages/SizeEditPage'
import { SizesListPage } from './pages/SizesListPage'
import { SimpleDictionaryListPage } from './pages/SimpleDictionaryListPage'
import { SimpleDictionaryCreatePage } from './pages/SimpleDictionaryCreatePage'
import { SimpleDictionaryEditPage } from './pages/SimpleDictionaryEditPage'
import { LoginPage } from './pages/LoginPage'
import { ProductCreatePage } from './pages/ProductCreatePage'
import { ProductEditPage } from './pages/ProductEditPage'
import { RegisterPage } from './pages/RegisterPage'
import { UsersPage } from './pages/UsersPage'
import { AdminRoute } from './routes/AdminRoute'
import { ManagerAdminRoute } from './routes/ManagerAdminRoute'
import { ProtectedLayout } from './routes/ProtectedLayout'
import { ClientCabinetLayout } from './routes/ClientCabinetLayout'
import { ClientCabinetDashboardPage } from './pages/ClientCabinetDashboardPage'
import { ClientCabinetBalancesPage } from './pages/ClientCabinetBalancesPage'
import { ClientCabinetOperationsPage } from './pages/ClientCabinetOperationsPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/auth" replace />} />
      <Route element={<AuthLayout />}>
        <Route path="/auth" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
      </Route>
      <Route element={<ProtectedLayout />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/cabinet" element={<ClientCabinetLayout />}>
          <Route index element={<ClientCabinetDashboardPage />} />
          <Route path="balances" element={<ClientCabinetBalancesPage />} />
          <Route path="receipts" element={<ClientCabinetOperationsPage opType="in" />} />
          <Route path="shipments" element={<ClientCabinetOperationsPage opType="out" />} />
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
            <ManagerAdminRoute>
              <AnalyticsPage />
            </ManagerAdminRoute>
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
  )
}

export default App
