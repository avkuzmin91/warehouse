import { lazy } from 'react'
import { Route } from 'react-router-dom'

const MarketplacesOrdersPage = lazy(() =>
  import('../pages/MarketplacesOrdersPage').then((m) => ({ default: m.MarketplacesOrdersPage })),
)
const MarketplacesOrderDetailPage = lazy(() =>
  import('../pages/MarketplacesOrderDetailPage').then((m) => ({ default: m.MarketplacesOrderDetailPage })),
)
const MarketplacesLinksPage = lazy(() =>
  import('../pages/MarketplacesLinksPage').then((m) => ({ default: m.MarketplacesLinksPage })),
)
const MarketplacesAccountsPage = lazy(() =>
  import('../pages/MarketplacesAccountsPage').then((m) => ({ default: m.MarketplacesAccountsPage })),
)
const MarketplacesSuppliesPage = lazy(() =>
  import('../pages/MarketplacesSuppliesPage').then((m) => ({ default: m.MarketplacesSuppliesPage })),
)
const MarketplacesSupplyDetailPage = lazy(() =>
  import('../pages/MarketplacesSupplyDetailPage').then((m) => ({ default: m.MarketplacesSupplyDetailPage })),
)

export const marketplacesRoutes = [
  <Route key="marketplaces-supplies" path="/marketplaces/supplies" element={<MarketplacesSuppliesPage />} />,
  <Route key="marketplaces-supplies-id" path="/marketplaces/supplies/:supplyId" element={<MarketplacesSupplyDetailPage />} />,
  <Route key="marketplaces-orders" path="/marketplaces/orders" element={<MarketplacesOrdersPage />} />,
  <Route key="marketplaces-orders-id" path="/marketplaces/orders/:orderId" element={<MarketplacesOrderDetailPage />} />,
  <Route key="marketplaces-links" path="/marketplaces/links" element={<MarketplacesLinksPage />} />,
  <Route key="marketplaces-accounts" path="/marketplaces/accounts" element={<MarketplacesAccountsPage />} />,
]
