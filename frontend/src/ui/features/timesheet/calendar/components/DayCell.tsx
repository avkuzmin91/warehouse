import { Icon } from '../../../../primitives/Icon'
import {
  STATE, dayState, isWorkingState, isoOf, type OverrideMap,
} from '../shared/calCore'

type Props = {
  dt: Date | null
  overrides: OverrideMap
  selected: boolean
  inRange: boolean
  today: string
  onMouseDown: (iso: string) => void
  onMouseEnter: (iso: string) => void
}

export function DayCell({ dt, overrides, selected, inRange, today, onMouseDown, onMouseEnter }: Props) {
  if (!dt) return <div />
  const iso = isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
  const st = dayState(dt, overrides)
  const m = STATE[st]
  const ov = overrides[iso]
  const isToday = iso === today
  const working = isWorkingState(st)
  const highlighted = selected || inRange

  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onMouseDown(iso) }}
      onMouseEnter={() => onMouseEnter(iso)}
      style={{
        minHeight: 76, borderRadius: 10, cursor: 'pointer', textAlign: 'left',
        border: highlighted ? '2px solid var(--c-accent)' : `1px solid ${st === 'work' ? 'var(--c-border)' : m.dot}`,
        background: inRange ? 'var(--c-accent-bg)' : m.fill,
        color: inRange ? 'var(--c-accent-text)' : m.text,
        padding: '7px 9px', position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 3,
        boxShadow: highlighted ? '0 0 0 3px var(--c-accent-bg)' : 'none',
        outline: isToday && !highlighted ? '2px solid var(--c-accent)' : 'none',
        outlineOffset: isToday && !highlighted ? -2 : 0,
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>{dt.getDate()}</span>
        {isToday && <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--c-accent)',
          background: 'var(--c-accent-bg)', padding: '1px 5px', borderRadius: 99,
        }}>СЕГОДНЯ</span>}
        {inRange && <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />}
        {!inRange && !working && !isToday && <Icon name="x" size={12} style={{ color: m.dot }} />}
        {!inRange && st === 'worksun' && !isToday && <Icon name="sun" size={12} style={{ color: m.dot }} />}
      </div>
      {!inRange && ov?.reason && (
        <span style={{
          fontSize: 10.5, lineHeight: 1.25, color: m.text, opacity: 0.85,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{ov.reason}</span>
      )}
    </button>
  )
}
