import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthLayout } from './components/AuthLayout'
import { DashboardPage } from './pages/DashboardPage'
import { DictionariesPage } from './pages/DictionariesPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { UsersPage } from './pages/UsersPage'
import { AdminRoute } from './routes/AdminRoute'
import { ProtectedRoute } from './routes/ProtectedRoute'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/auth" replace />} />
      <Route element={<AuthLayout />}>
        <Route path="/auth" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
      </Route>
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
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
      <Route
        path="/dictionaries"
        element={<Navigate to="/dictionaries/clients" replace />}
      />
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  )
}

export default App
