import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthTabSync } from '../auth/AuthTabSync'
import { authRoutes } from './routes/auth'
import { inventoryRoutes } from './routes/inventory'
import { logisticsRoutes } from './routes/logistics'
import { financeRoutes } from './routes/finance'
import { marketplacesRoutes } from './routes/marketplaces'
import { timesheetRoutes } from './routes/timesheet'
import { cabinetRoutes } from './routes/cabinet'
import { adminRoutes } from './routes/admin'
import { AppLayout } from './layouts/AppLayout'
import { LoadingScreen } from './feedback/LoadingScreen'

export function App() {
  return (
    <>
      <AuthTabSync />
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/" element={<Navigate to="/auth" replace />} />
          {authRoutes}
          <Route element={<AppLayout />}>
            {adminRoutes}
            {inventoryRoutes}
            {logisticsRoutes}
            {financeRoutes}
            {marketplacesRoutes}
            {timesheetRoutes}
            {cabinetRoutes}
          </Route>
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </Suspense>
    </>
  )
}
