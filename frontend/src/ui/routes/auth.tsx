import { lazy } from 'react'
import { Route } from 'react-router-dom'

const AuthLayout = lazy(() =>
  import('../layouts/AuthLayout').then((m) => ({ default: m.AuthLayout })),
)
const LoginPage = lazy(() =>
  import('../pages/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const RegisterPage = lazy(() =>
  import('../pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
)

export const authRoutes = (
  <Route element={<AuthLayout />}>
    <Route path="/auth" element={<LoginPage />} />
    <Route path="/auth/register" element={<RegisterPage />} />
  </Route>
)
