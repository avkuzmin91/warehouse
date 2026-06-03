import { lazy } from 'react'
import { Route } from 'react-router-dom'

const LogisticsTripsListPage = lazy(() =>
  import('../pages/LogisticsTripsListPage').then((m) => ({ default: m.LogisticsTripsListPage })),
)
const LogisticsTripCreatePage = lazy(() =>
  import('../pages/LogisticsTripCreatePage').then((m) => ({ default: m.LogisticsTripCreatePage })),
)
const LogisticsTripDetailPage = lazy(() =>
  import('../pages/LogisticsTripDetailPage').then((m) => ({ default: m.LogisticsTripDetailPage })),
)
const LogisticsKitPage = lazy(() =>
  import('../pages/LogisticsKitPage').then((m) => ({ default: m.LogisticsKitPage })),
)

export const logisticsRoutes = [
  <Route key="logistics-trips" path="/logistics/trips" element={<LogisticsTripsListPage />} />,
  <Route key="logistics-trips-new" path="/logistics/trips/new" element={<LogisticsTripCreatePage />} />,
  <Route key="logistics-trips-id" path="/logistics/trips/:tripId" element={<LogisticsTripDetailPage />} />,
  // Витрина общих компонентов редизайна (Шаг 1/4), в изоляции — не встроена в экраны рейса.
  <Route key="logistics-kit" path="/logistics/kit" element={<LogisticsKitPage />} />,
]
