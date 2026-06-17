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
const FinanceTransactionsPage = lazy(() =>
  import('../pages/FinanceTransactionsPage').then((m) => ({ default: m.FinanceTransactionsPage })),
)
const FinanceRentPage = lazy(() =>
  import('../pages/FinanceRentPage').then((m) => ({ default: m.FinanceRentPage })),
)
const FinanceSalaryPage = lazy(() =>
  import('../pages/FinanceSalaryPage').then((m) => ({ default: m.FinanceSalaryPage })),
)

export const financeRoutes = [
  <Route key="finance-invoices" path="/finance/invoices" element={<FinanceInvoicesListPage />} />,
  <Route key="finance-invoices-new" path="/finance/invoices/new" element={<FinanceInvoiceCreatePage />} />,
  <Route key="finance-uninvoiced" path="/finance/uninvoiced" element={<FinanceUninvoicedShipmentsPage />} />,
  <Route key="finance-invoices-id" path="/finance/invoices/:invoiceId" element={<FinanceInvoiceDetailPage />} />,
  <Route key="finance-expenses" path="/finance/expenses" element={<FinanceExpensesListPage />} />,
  <Route key="finance-transactions" path="/finance/transactions" element={<FinanceTransactionsPage />} />,
  <Route key="finance-rent" path="/finance/rent" element={<FinanceRentPage />} />,
  <Route key="finance-salary" path="/finance/salary" element={<FinanceSalaryPage />} />,
]
