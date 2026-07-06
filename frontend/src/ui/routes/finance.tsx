import { lazy } from 'react'
import { Route } from 'react-router-dom'

const FinanceInvoicesListPage = lazy(() =>
  import('../pages/FinanceInvoicesListPage').then((m) => ({ default: m.FinanceInvoicesListPage })),
)
const FinanceUninvoicedShipmentsPage = lazy(() =>
  import('../pages/FinanceUninvoicedShipmentsPage').then((m) => ({ default: m.FinanceUninvoicedShipmentsPage })),
)
const FinanceInvoiceCreatePage = lazy(() =>
  import('../pages/FinanceInvoiceCreatePage').then((m) => ({ default: m.FinanceInvoiceCreatePage })),
)
const FinanceInvoiceDetailPage = lazy(() =>
  import('../pages/FinanceInvoiceDetailPage').then((m) => ({ default: m.FinanceInvoiceDetailPage })),
)
const FinanceExpensesListPage = lazy(() =>
  import('../pages/FinanceExpensesListPage').then((m) => ({ default: m.FinanceExpensesListPage })),
)
const FinancePackingPricesPage = lazy(() =>
  import('../pages/FinancePackingPricesPage').then((m) => ({ default: m.FinancePackingPricesPage })),
)
const FinancePalletPricesPage = lazy(() =>
  import('../pages/FinancePalletPricesPage').then((m) => ({ default: m.FinancePalletPricesPage })),
)
const FinanceBoxPricesPage = lazy(() =>
  import('../pages/FinanceBoxPricesPage').then((m) => ({ default: m.FinanceBoxPricesPage })),
)
const FinanceStoragePricesPage = lazy(() =>
  import('../pages/FinanceStoragePricesPage').then((m) => ({ default: m.FinanceStoragePricesPage })),
)
const FinanceStorageReportPage = lazy(() =>
  import('../pages/FinanceStorageReportPage').then((m) => ({ default: m.FinanceStorageReportPage })),
)
const FinanceRecurringExpensesPage = lazy(() =>
  import('../pages/FinanceRecurringExpensesPage').then((m) => ({ default: m.FinanceRecurringExpensesPage })),
)
const FinanceExtraIncomePage = lazy(() =>
  import('../pages/FinanceExtraIncomePage').then((m) => ({ default: m.FinanceExtraIncomePage })),
)

export const financeRoutes = [
  <Route key="finance-invoices" path="/finance/invoices" element={<FinanceInvoicesListPage />} />,
  <Route key="finance-invoices-new" path="/finance/invoices/new" element={<FinanceInvoiceCreatePage />} />,
  <Route key="finance-uninvoiced" path="/finance/uninvoiced" element={<FinanceUninvoicedShipmentsPage />} />,
  <Route key="finance-invoices-id" path="/finance/invoices/:invoiceId" element={<FinanceInvoiceDetailPage />} />,
  <Route key="finance-expenses" path="/finance/expenses" element={<FinanceExpensesListPage />} />,
  <Route key="finance-extra-income" path="/finance/extra-income" element={<FinanceExtraIncomePage />} />,
  <Route key="finance-recurring" path="/finance/recurring" element={<FinanceRecurringExpensesPage />} />,
  <Route key="finance-pricing" path="/finance/pricing" element={<FinancePackingPricesPage />} />,
  <Route key="finance-pallet-pricing" path="/finance/pallet-pricing" element={<FinancePalletPricesPage />} />,
  <Route key="finance-box-pricing" path="/finance/box-pricing" element={<FinanceBoxPricesPage />} />,
  <Route key="finance-storage-pricing" path="/finance/storage-pricing" element={<FinanceStoragePricesPage />} />,
  <Route key="finance-storage" path="/finance/storage" element={<FinanceStorageReportPage />} />,
]
