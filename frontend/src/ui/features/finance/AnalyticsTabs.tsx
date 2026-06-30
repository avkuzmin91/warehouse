import { useFilterParam } from '../../../hooks/useFilterParams'

export type AnalyticsTab = 'pnl' | 'expenses' | 'trips'

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'pnl', label: 'Доходы и расходы' },
  { id: 'expenses', label: 'Расходы' },
  { id: 'trips', label: 'Рентабельность рейсов' },
]

export function AnalyticsTabs({ active }: { active: AnalyticsTab }) {
  const [, setTab] = useFilterParam('tab', 'pnl')
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
