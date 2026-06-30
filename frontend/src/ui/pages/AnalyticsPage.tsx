import { useFilterParam } from '../../hooks/useFilterParams'
import { ExpensesAnalyticsFeature } from '../features/finance/ExpensesAnalyticsFeature'
import { PnlFeature } from '../features/finance/pnl/PnlFeature'
import { TripProfitabilityFeature } from '../features/finance/TripProfitabilityFeature'

export function AnalyticsPage() {
  const [tab] = useFilterParam('tab', 'pnl')
  if (tab === 'expenses') return <ExpensesAnalyticsFeature />
  if (tab === 'trips') return <TripProfitabilityFeature />
  return <PnlFeature />
}
