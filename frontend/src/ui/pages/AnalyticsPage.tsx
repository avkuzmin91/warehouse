import { useFilterParam } from '../../hooks/useFilterParams'
import { ExpensesAnalyticsFeature } from '../features/finance/ExpensesAnalyticsFeature'
import { IncomeAnalyticsFeature } from '../features/finance/IncomeAnalyticsFeature'
import { PnlFeature } from '../features/finance/pnl/PnlFeature'
import { TripProfitabilityFeature } from '../features/finance/TripProfitabilityFeature'
import { LogisticsAnalyticsFeature } from '../features/finance/LogisticsAnalyticsFeature'
import { PackingAnalyticsFeature } from '../features/finance/PackingAnalyticsFeature'
import { SettlementsAnalyticsFeature } from '../features/finance/SettlementsAnalyticsFeature'

export function AnalyticsPage() {
  const [tab] = useFilterParam('tab', 'pnl')
  if (tab === 'settlements') return <SettlementsAnalyticsFeature />
  if (tab === 'income') return <IncomeAnalyticsFeature />
  if (tab === 'expenses') return <ExpensesAnalyticsFeature />
  if (tab === 'trips') return <TripProfitabilityFeature />
  if (tab === 'logistics') return <LogisticsAnalyticsFeature />
  if (tab === 'packing') return <PackingAnalyticsFeature />
  return <PnlFeature />
}
