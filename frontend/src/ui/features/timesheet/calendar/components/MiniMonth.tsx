import type { CalendarException } from '../../../../../api/productionCalendarApi'
import {
  MONTHS, STATE, dayState, isoOf, monthGrid, overridesFromItems,
} from '../shared/calCore'

const MINI_HEAD = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В']

type Props = {
  year: number
  month: number
  workingDaysCount: number
  items: CalendarException[]
  today: string
  highlight?: boolean
  onClick: () => void
}

export function MiniMonth({ year, month, workingDaysCount, items, today, highlight, onClick }: Props) {
  const overrides = overridesFromItems(items)
  const grid = monthGrid(year, month)
  const exs = [...items].sort((a, b) => a.cal_date.localeCompare(b.cal_date))

  return (
    <button
      onClick={onClick}
      className="card"
      style={{
        padding: '12px 12px 11px', cursor: 'pointer', textAlign: 'left', width: '100%',
        borderColor: highlight ? 'var(--c-accent-border)' : 'var(--c-border)',
        boxShadow: highlight ? '0 0 0 1px var(--c-accent-border)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{MONTHS[month - 1]}</span>
        <span style={{ fontSize: 11, color: 'var(--c-text-subtle)', fontFamily: 'var(--font-mono)' }}>{workingDaysCount} раб.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {MINI_HEAD.map((w, i) => (
          <div key={i} style={{
            textAlign: 'center', fontSize: 9, fontWeight: 600,
            color: i === 6 ? 'var(--c-text-faint)' : 'var(--c-text-subtle)', paddingBottom: 2,
          }}>{w}</div>
        ))}
        {grid.map((dt, idx) => {
          if (!dt) return <div key={`e${idx}`} />
          const st = dayState(dt, overrides)
          const m = STATE[st]
          const iso = isoOf(year, month, dt.getDate())
          const isToday = iso === today
          return (
            <div key={idx} title={overrides[iso]?.reason || m.label}
              style={{
                aspectRatio: '1 / 1', borderRadius: 4, fontSize: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: st === 'work' ? 'transparent' : m.fill,
                color: isToday ? 'var(--c-accent)' : m.text,
                border: isToday ? '1.5px solid var(--c-accent)' : '1px solid transparent',
                fontWeight: isToday ? 700 : st === 'work' ? 400 : 600,
              }}>
              {dt.getDate()}
            </div>
          )
        })}
      </div>
      {exs.length > 0 && (
        <div style={{
          marginTop: 9, paddingTop: 8, borderTop: '1px dashed var(--c-border)',
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {exs.slice(0, 2).map((h) => (
            <div key={h.cal_date} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: 'var(--c-text-muted)' }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                background: STATE[h.is_working ? 'worksun' : 'holiday'].dot,
              }} />
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-text-subtle)' }}>{h.cal_date.slice(8)}</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.reason}</span>
            </div>
          ))}
          {exs.length > 2 && <div style={{ fontSize: 10.5, color: 'var(--c-text-subtle)' }}>+ ещё {exs.length - 2}</div>}
        </div>
      )}
    </button>
  )
}
