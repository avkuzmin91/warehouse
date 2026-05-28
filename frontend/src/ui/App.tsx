import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthTabSync } from '../auth/AuthTabSync'
import { authRoutes } from './routes/auth'
import { inventoryRoutes } from './routes/inventory'
import { cabinetRoutes } from './routes/cabinet'
import { adminRoutes } from './routes/admin'
import { AppLayout } from './layouts/AppLayout'

function LoadingFallback() {
  return (
    <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 24, height: 24, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )
}

export function App() {
  return (
    <>
      <AuthTabSync />
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/auth" replace />} />
          {authRoutes}
          <Route element={<AppLayout />}>
            {adminRoutes}
            {inventoryRoutes}
            {cabinetRoutes}
          </Route>
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}
