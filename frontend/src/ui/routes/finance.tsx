import { lazy } from 'react'
import { Navigate, Route } from 'react-router-dom'

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
  // Тарифы услуг переехали в «Справочники» → «Стоимости услуг»; старые URL — редиректы.
  <Route key="finance-pricing" path="/finance/pricing" element={<Navigate to="/dictionaries?type=packing-pricing" replace />} />,
  <Route key="finance-pallet-pricing" path="/finance/pallet-pricing" element={<Navigate to="/dictionaries?type=pallet-pricing" replace />} />,
  <Route key="finance-box-pricing" path="/finance/box-pricing" element={<Navigate to="/dictionaries?type=box-pricing" replace />} />,
  <Route key="finance-storage-pricing" path="/finance/storage-pricing" element={<Navigate to="/dictionaries?type=storage-pricing" replace />} />,
  <Route key="finance-storage" path="/finance/storage" element={<FinanceStorageReportPage />} />,
]
