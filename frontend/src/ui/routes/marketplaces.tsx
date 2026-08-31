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
const MarketplacesStocksPage = lazy(() =>
  import('../pages/MarketplacesStocksPage').then((m) => ({ default: m.MarketplacesStocksPage })),
)
const MarketplacesAccountsPage = lazy(() =>
  import('../pages/MarketplacesAccountsPage').then((m) => ({ default: m.MarketplacesAccountsPage })),
)

export const marketplacesRoutes = [
  <Route key="marketplaces-orders" path="/marketplaces/orders" element={<MarketplacesOrdersPage />} />,
  <Route key="marketplaces-orders-id" path="/marketplaces/orders/:orderId" element={<MarketplacesOrderDetailPage />} />,
  <Route key="marketplaces-links" path="/marketplaces/links" element={<MarketplacesLinksPage />} />,
  <Route key="marketplaces-stocks" path="/marketplaces/stocks" element={<MarketplacesStocksPage />} />,
  <Route key="marketplaces-accounts" path="/marketplaces/accounts" element={<MarketplacesAccountsPage />} />,
]
