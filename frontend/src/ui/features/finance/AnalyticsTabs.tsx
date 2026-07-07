import { useFilterParam } from '../../../hooks/useFilterParams'

export type AnalyticsTab = 'income' | 'expenses' | 'pnl' | 'trips' | 'packing'

const TABS: { id: AnalyticsTab; label: string }[] = [
  { id: 'pnl', label: 'Доходы и расходы' },
  { id: 'income', label: 'Доходы' },
  { id: 'expenses', label: 'Расходы' },
  { id: 'trips', label: 'Рентабельность рейсов' },
  { id: 'packing', label: 'Упаковка' },
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
