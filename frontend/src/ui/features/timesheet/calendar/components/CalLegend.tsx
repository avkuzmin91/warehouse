import { Icon } from '../../../../primitives/Icon'
import { STATE, STATE_LEGEND } from '../shared/calCore'

export function CalLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: compact ? 12 : 16, flexWrap: 'wrap',
      fontSize: 11.5, color: 'var(--c-text-muted)',
    }}>
      {STATE_LEGEND.map((s) => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 12, height: 12, borderRadius: 3, background: STATE[s].fill,
            border: `1px solid ${s === 'work' ? 'var(--c-border-strong)' : STATE[s].dot}`,
          }} />
          {STATE[s].label}
        </span>
      ))}
    </div>
  )
}

export function RuleChip() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px',
      borderRadius: 99, fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)',
      background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)',
    }}>
      <Icon name="briefcase" size={13} style={{ color: 'var(--c-text-subtle)' }} />
      Режим 6/1 · рабочие Пн–Сб, выходной — Вс
    </span>
  )
}
