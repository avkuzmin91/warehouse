import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthLayout } from './components/AuthLayout'
import { HomePage } from './pages/HomePage'
import { InventoryPage } from './pages/InventoryPage'
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
        <Route
          path="/inventory"
          element={
            <ManagerAdminRoute>
              <InventoryPage />
            </ManagerAdminRoute>
          }
        />
        <Route
          path="/users"
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
