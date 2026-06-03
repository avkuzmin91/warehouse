import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'
import { RoleChip } from './RoleChip'
import type { TripRole } from './RoleChip'
import type { TripOp, TripStatus } from '../../../../api/tripsApi'

/** Вертикальный таймлайн фаз рейса. Заменяет горизонтальный TripStepper. */

const STATUS_ORDER: TripStatus[] = ['draft', 'awaiting_arrival', 'unloading', 'costing', 'closed']

const META: Record<string, { title: string; role: TripRole | null; icon: IconName }> = {
  draft:            { title: 'Планирование',         role: 'manager',   icon: 'edit' },
  awaiting_arrival: { title: 'Ожидает прибытия',      role: 'warehouse', icon: 'clock' },
  unloading:        { title: 'Разгрузка',             role: 'warehouse', icon: 'forklift' },
  costing:          { title: 'Уточнение стоимости',   role: 'manager',   icon: 'ruble' },
  closed:           { title: 'Закрыт',                role: null,        icon: 'check' },
}

// trip_ops.op_type → статус, для которого это отметка времени (как в TripStepper).
const OP_TO_STATUS: Record<string, TripStatus> = {
  doc_create: 'draft',
  handoff: 'awaiting_arrival',
  arrival: 'unloading',
  unload_done: 'costing',
  close: 'closed',
}

function getTimestamps(ops: TripOp[]): Partial<Record<TripStatus, string>> {
  const ts: Partial<Record<TripStatus, string>> = {}
  for (const op of ops) {
    const s = OP_TO_STATUS[op.op_type]
    if (s && !ts[s]) ts[s] = op.created_at
  }
  return ts
}

function fmt(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function ProcessRail({ status, ops = [] }: { status: TripStatus; ops?: TripOp[] }) {
  const cancelled = status === 'cancelled'
  const curIdx = cancelled ? 1 : STATUS_ORDER.indexOf(status)
  const ts = getTimestamps(ops)

  return (
    <div style={{ padding: '6px 4px' }}>
      {STATUS_ORDER.map((s, i) => {
        const m = META[s]
        const state: 'done' | 'active' | 'future' = i < curIdx ? 'done' : i === curIdx ? 'active' : 'future'
        const last = i === STATUS_ORDER.length - 1
        const dotColor = state === 'done' ? 'var(--c-success)'
          : state === 'active' ? (m.role === 'warehouse' ? 'var(--c-info)' : 'var(--c-accent)')
          : 'var(--c-border-strong)'
        const t = ts[s]
        return (
          <div key={s} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22 }}>
              <div style={{
                width: 22, height: 22, borderRadius: 99, flexShrink: 0, zIndex: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: state === 'future' ? 'var(--c-bg-elev)' : dotColor,
                border: state === 'future' ? '1.5px dashed var(--c-border-strong)' : `1.5px solid ${dotColor}`,
                color: state === 'future' ? 'var(--c-text-faint)' : '#fff',
                boxShadow: state === 'active' ? `0 0 0 4px color-mix(in oklab, ${dotColor} 16%, transparent)` : 'none',
              }}>
                {state === 'done' ? <Icon name="check" size={11} /> : <Icon name={m.icon} size={11} />}
              </div>
              {!last && (
                <div style={{ width: 2, flex: 1, minHeight: 26, background: i < curIdx ? 'var(--c-success)' : 'var(--c-border)' }} />
              )}
            </div>
            <div style={{ paddingBottom: last ? 0 : 16, flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  fontSize: 13, fontWeight: state === 'active' ? 600 : 500,
                  color: state === 'future' ? 'var(--c-text-subtle)' : 'var(--c-text)',
                }}>{m.title}</span>
                {state === 'active' && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: dotColor }}>
                    сейчас
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                {m.role && <RoleChip role={m.role} faded={state === 'future'} />}
                <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                  {state === 'future' || !t ? '—' : fmt(t)}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
