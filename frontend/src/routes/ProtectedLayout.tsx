import { Navigate } from 'react-router-dom'
import { AppLayout } from '../components/AppLayout'

/**
 * Обертка для защищённых маршрутов: токен + AppLayout (шапка + контент).
 */
export function ProtectedLayout() {
  const token = localStorage.getItem('token')
  if (!token) {
    return <Navigate to="/auth" replace />
  }
  return <AppLayout />
}
