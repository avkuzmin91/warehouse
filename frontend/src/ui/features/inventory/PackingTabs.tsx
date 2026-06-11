import { useFilterParamsActions } from '../../../hooks/useFilterParams'

const TABS = [
  { id: 'queue', label: 'Очередь' },
  { id: 'productivity', label: 'Производительность' },
] as const

export type PackingTabId = (typeof TABS)[number]['id']

export function PackingTabs({ active }: { active: PackingTabId }) {
  const { setMany } = useFilterParamsActions()
  return (
    <div className="tabs" style={{ marginBottom: 14 }}>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tab${active === t.id ? ' active' : ''}`}
          onClick={() => {
            if (t.id === active) return
            // Фильтры сбрасываются: у вкладок разные дефолтные периоды (сегодня / неделя).
            setMany({ tab: t.id === 'queue' ? null : t.id, search: null, client: null, from: null, to: null })
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
