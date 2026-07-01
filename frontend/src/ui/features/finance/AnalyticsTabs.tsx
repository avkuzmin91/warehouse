import { useFilterParam } from '../../../hooks/useFilterParams'

export type AnalyticsTab = 'income' | 'expenses' | 'pnl' | 'trips'

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'income', label: 'Доходы' },
  { id: 'expenses', label: 'Расходы' },
  { id: 'pnl', label: 'Доходы и расходы' },
  { id: 'trips', label: 'Рентабельность рейсов' },
]

export function AnalyticsTabs({ active }: { active: AnalyticsTab }) {
  const [, setTab] = useFilterParam('tab', 'income')
  return (
    <div className="tabs" style={{ marginBottom: 14 }}>
      {TABS.map((t) => (
        <button key={t.id} className={`tab${active === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
