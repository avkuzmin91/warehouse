import { useFilterParam } from '../../hooks/useFilterParams'
import { ExpensesAnalyticsFeature } from '../features/finance/ExpensesAnalyticsFeature'
import { IncomeAnalyticsFeature } from '../features/finance/IncomeAnalyticsFeature'
import { PnlFeature } from '../features/finance/pnl/PnlFeature'
import { TripProfitabilityFeature } from '../features/finance/TripProfitabilityFeature'

export function AnalyticsPage() {
  const [tab] = useFilterParam('tab', 'income')
  if (tab === 'expenses') return <ExpensesAnalyticsFeature />
  if (tab === 'pnl') return <PnlFeature />
  if (tab === 'trips') return <TripProfitabilityFeature />
  return <IncomeAnalyticsFeature />
}
