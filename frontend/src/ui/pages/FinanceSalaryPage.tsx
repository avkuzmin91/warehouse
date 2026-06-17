import { ExpensesListFeature } from '../features/finance/expenses/ExpensesListFeature'

export function FinanceSalaryPage() {
  return (
    <ExpensesListFeature
      variant={{
        title: 'Оплата ЗП',
        subtitle: 'Выплаты сотрудникам',
        kindScope: ['salary'],
        showKind: false,
        createKind: 'salary',
        createLabel: 'Выплатить ЗП',
      }}
    />
  )
}
