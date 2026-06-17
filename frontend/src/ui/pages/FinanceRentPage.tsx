import { ExpensesListFeature } from '../features/finance/expenses/ExpensesListFeature'

export function FinanceRentPage() {
  return (
    <ExpensesListFeature
      variant={{
        title: 'Оплата склада',
        subtitle: 'Аренда и периодические платежи за склад',
        kindScope: ['rent'],
        showKind: false,
        createKind: 'rent',
        createLabel: 'Добавить оплату',
      }}
    />
  )
}
