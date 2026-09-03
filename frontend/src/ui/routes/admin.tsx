import { lazy } from 'react'
import { Navigate, Route } from 'react-router-dom'

const DictionariesPage = lazy(() =>
  import('../pages/DictionariesPage').then((m) => ({ default: m.DictionariesPage })),
)

const HomePage = lazy(() =>
  import('../pages/HomePage').then((m) => ({ default: m.HomePage })),
)
const ChangePasswordPage = lazy(() =>
  import('../pages/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })),
)
const AccessDeniedPage = lazy(() =>
  import('../pages/AccessDeniedPage').then((m) => ({ default: m.AccessDeniedPage })),
)
const AnalyticsPage = lazy(() =>
  import('../pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })),
)
const UsersPage = lazy(() =>
  import('../pages/UsersPage').then((m) => ({ default: m.UsersPage })),
)
const ClientCreatePage = lazy(() =>
  import('../pages/ClientCreatePage').then((m) => ({ default: m.ClientCreatePage })),
)
const ClientEditPage = lazy(() =>
  import('../pages/ClientEditPage').then((m) => ({ default: m.ClientEditPage })),
)
const SizeCreatePage = lazy(() =>
  import('../pages/SizeCreatePage').then((m) => ({ default: m.SizeCreatePage })),
)
const SizeEditPage = lazy(() =>
  import('../pages/SizeEditPage').then((m) => ({ default: m.SizeEditPage })),
)
const SimpleDictionaryCreatePage = lazy(() =>
  import('../pages/SimpleDictionaryCreatePage').then((m) => ({ default: m.SimpleDictionaryCreatePage })),
)
const SimpleDictionaryEditPage = lazy(() =>
  import('../pages/SimpleDictionaryEditPage').then((m) => ({ default: m.SimpleDictionaryEditPage })),
)
const ProductCreatePage = lazy(() =>
  import('../pages/ProductCreatePage').then((m) => ({ default: m.ProductCreatePage })),
)
const ProductEditPage = lazy(() =>
  import('../pages/ProductEditPage').then((m) => ({ default: m.ProductEditPage })),
)
const ProductBulkImportPage = lazy(() =>
  import('../pages/ProductBulkImportPage').then((m) => ({ default: m.ProductBulkImportPage })),
)
const ProductViewPage = lazy(() =>
  import('../pages/ProductViewPage').then((m) => ({ default: m.ProductViewPage })),
)

export const adminRoutes = [
  <Route key="home" path="/home" element={<HomePage />} />,
  <Route key="account-password" path="/account/password" element={<ChangePasswordPage />} />,
  <Route key="access-denied" path="/access-denied" element={<AccessDeniedPage />} />,

  <Route key="analytics" path="/analytics" element={<AnalyticsPage />} />,

  <Route key="users-redirect" path="/users" element={<Navigate to="/dictionaries/users" replace />} />,
  <Route key="dictionaries-users" path="/dictionaries/users" element={<UsersPage />} />,

  // New unified dictionaries page — tab-based with ?type= query param
  <Route key="dictionaries" path="/dictionaries" element={<DictionariesPage />} />,

  // Redirect old per-section list routes → new tab-based page
  <Route key="dictionaries-clients-list" path="/dictionaries/clients" element={<Navigate to="/dictionaries?type=clients" replace />} />,
  <Route key="dictionaries-sizes-list" path="/dictionaries/sizes" element={<Navigate to="/dictionaries?type=sizes" replace />} />,
  <Route key="dictionaries-colors-list" path="/dictionaries/colors" element={<Navigate to="/dictionaries?type=colors" replace />} />,
  <Route key="dictionaries-product-types-list" path="/dictionaries/product-types" element={<Navigate to="/dictionaries?type=product-types" replace />} />,
  <Route key="dictionaries-products-list" path="/dictionaries/products" element={<Navigate to="/dictionaries?type=products" replace />} />,
  <Route key="dictionaries-warehouses-list" path="/dictionaries/warehouses" element={<Navigate to="/dictionaries?type=warehouses" replace />} />,
  <Route key="dictionaries-carriers-list" path="/dictionaries/carriers" element={<Navigate to="/dictionaries?type=carriers" replace />} />,
  <Route key="dictionaries-vehicle-types-list" path="/dictionaries/vehicle-types" element={<Navigate to="/dictionaries?type=vehicle-types" replace />} />,
  <Route key="dictionaries-reasons-list" path="/dictionaries/reasons" element={<Navigate to="/dictionaries" replace />} />,

  // Create / edit routes for products and clients (full-page forms, kept intact)
  <Route key="dictionaries-clients-new" path="/dictionaries/clients/new" element={<ClientCreatePage />} />,
  <Route key="dictionaries-clients-id" path="/dictionaries/clients/:id" element={<ClientEditPage />} />,

  <Route key="dictionaries-sizes-new" path="/dictionaries/sizes/new" element={<SizeCreatePage />} />,
  <Route key="dictionaries-sizes-id" path="/dictionaries/sizes/:id" element={<SizeEditPage />} />,

  <Route key="dictionaries-colors-new" path="/dictionaries/colors/new" element={<SimpleDictionaryCreatePage entity="colors" />} />,
  <Route key="dictionaries-colors-id" path="/dictionaries/colors/:id" element={<SimpleDictionaryEditPage entity="colors" />} />,

  <Route key="dictionaries-product-types-new" path="/dictionaries/product-types/new" element={<SimpleDictionaryCreatePage entity="product-types" />} />,
  <Route key="dictionaries-product-types-id" path="/dictionaries/product-types/:id" element={<SimpleDictionaryEditPage entity="product-types" />} />,

  <Route key="dictionaries-suppliers" path="/dictionaries/suppliers" element={<Navigate to="/dictionaries?type=suppliers" replace />} />,
  <Route key="dictionaries-suppliers-new" path="/dictionaries/suppliers/new" element={<SimpleDictionaryCreatePage entity="suppliers" />} />,
  <Route key="dictionaries-suppliers-id" path="/dictionaries/suppliers/:id" element={<SimpleDictionaryEditPage entity="suppliers" />} />,

  <Route key="dictionaries-unloading-zones" path="/dictionaries/unloading-zones" element={<Navigate to="/dictionaries?type=unloading-zones" replace />} />,

  <Route key="dictionaries-products-new" path="/dictionaries/products/new" element={<ProductCreatePage />} />,
  <Route key="dictionaries-products-import" path="/dictionaries/products/import" element={<ProductBulkImportPage />} />,
  <Route key="dictionaries-products-id" path="/dictionaries/products/:id" element={<ProductViewPage />} />,
  <Route key="dictionaries-products-id-edit" path="/dictionaries/products/:id/edit" element={<ProductEditPage />} />,
]
