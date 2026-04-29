import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthLayout } from './components/AuthLayout'
import { HomePage } from './pages/HomePage'
import { InventoryPage } from './pages/InventoryPage'
import { DictionariesListPage } from './pages/DictionariesListPage'
import { DictionariesPage } from './pages/DictionariesPage'
import { LoginPage } from './pages/LoginPage'
import { ProductCreatePage } from './pages/ProductCreatePage'
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
          path="/dictionaries"
          element={
            <AdminRoute>
              <DictionariesListPage />
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
