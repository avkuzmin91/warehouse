import { ExpensesListFeature } from '../features/finance/expenses/ExpensesListFeature'

export function FinanceTransactionsPage() {
  return (
    <ExpensesListFeature
      variant={{
        title: 'Транзакции',
        subtitle: 'Все расходы: хозрасходы, логистика, склад, ЗП',
        showKind: true,
        createKind: null,
      }}
    />
  )
}
