import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { RoleChip } from '../shared/process/RoleChip'
import { Panel } from '../shared/process/processUI'
import type { InvoiceStatus } from '../../../api/invoicesApi'

/** Жизненный цикл счёта = процесс со статусом и сроком (в стиле рейла отгрузки/рейса).
 *  Остановки: Выставлен → Срок расчёта → Оплата → Завершён. У «Срока» особое
 *  поведение: при наступлении/просрочке — акцент и уведомление менеджеру + админу. */
export type InvoicePhase = 'draft' | 'issued' | 'paying' | 'closed' | 'cancelled'

export function invoicePhase(status: InvoiceStatus): InvoicePhase {
  switch (status) {
    case 'draft': return 'draft'
    case 'closed': return 'closed'
    case 'cancelled': return 'cancelled'
    case 'partially_paid': return 'paying'
    default: return 'issued'
  }
}

type RailKey = 'draft' | 'issued' | 'due' | 'paying' | 'closed'
type RailState = 'done' | 'active' | 'next' | 'future' | 'cancelled'

type RailDef = { key: RailKey; label: string; done: string; managed: boolean; icon: IconName; sub: string }

const RAIL: RailDef[] = [
  { key: 'draft',  label: 'Черновик',     done: 'Черновик создан', managed: true,  icon: 'edit',     sub: 'заполнение и файл счёта' },
  { key: 'issued', label: 'Выставлен',    done: 'Счёт выставлен',  managed: true,  icon: 'receipt',  sub: 'сумма зафиксирована, ждём оплату' },
  { key: 'due',    label: 'Срок расчёта', done: 'Срок наступил',   managed: false, icon: 'calendar', sub: 'уведомление менеджеру и админу' },
  { key: 'paying', label: 'Оплата',       done: 'Оплачен',         managed: true,  icon: 'coins',    sub: 'частичные оплаты, остаток уменьшается' },
  { key: 'closed', label: 'Завершён',     done: 'Счёт завершён',   managed: true,  icon: 'check',    sub: 'полностью оплачен' },
]

// «Срок» управляется dueReached (наступил, <= сегодня), а не оплатой: раньше он
// загорался при первой частичной оплате даже до плановой даты — это было неверно.
function railState(key: RailKey, phase: InvoicePhase, dueReached: boolean): RailState {
  if (phase === 'cancelled') return key === 'draft' ? 'done' : 'cancelled'
  if (phase === 'closed') return 'done'

  const reachedIssued = phase === 'issued' || phase === 'paying'
  const reachedPaying = phase === 'paying'

  switch (key) {
    case 'draft':
      return phase === 'draft' ? 'active' : 'done'
    case 'issued':
      if (phase === 'draft') return 'next'
      return reachedPaying ? 'done' : 'active'
    case 'due':
      if (!reachedIssued) return 'future'
      return dueReached ? 'active' : 'next'
    case 'paying':
      return reachedPaying ? 'active' : 'future'
    default:
      return 'future'
  }
}

export function InvoiceRailPanel({ phase, overdue, dueReached = false, dueDate, duePrev, stamps }: {
  phase: InvoicePhase
  overdue: boolean
  dueReached?: boolean
  dueDate: string
  duePrev?: string | null
  stamps: Partial<Record<RailKey, string>>
}) {
  return (
    <Panel icon="route" title="Жизненный цикл счёта" bodyPad={false}>
      <div style={{ padding: '12px 14px' }}>
        {RAIL.map((s, i) => {
          const st = railState(s.key, phase, dueReached)
          const last = i === RAIL.length - 1
          const isDue = s.key === 'due'
          const dueOverdue = isDue && st === 'active' && overdue
          const dotColor =
            st === 'done' ? 'var(--c-success)'
            : st === 'cancelled' ? 'var(--c-danger)'
            : st === 'active' ? (isDue ? (overdue ? 'var(--c-danger)' : 'var(--c-warning)') : 'var(--c-accent)')
            : 'var(--c-border-strong)'
          const dim = st === 'future' || st === 'next' || st === 'cancelled'
          const lineDone = st === 'done'
          return (
            <div key={s.key} style={{ display: 'flex', gap: 12, position: 'relative' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 99, flexShrink: 0, zIndex: 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: dim ? 'var(--c-bg-elev)' : dotColor,
                  border: st === 'future' || st === 'next' ? '1.5px dashed var(--c-border-strong)'
                    : st === 'cancelled' ? '1.5px solid var(--c-danger)' : `1.5px solid ${dotColor}`,
                  color: st === 'future' || st === 'next' ? 'var(--c-text-faint)'
                    : st === 'cancelled' ? 'var(--c-danger)' : 'var(--c-accent-contrast)',
                  boxShadow: st === 'active' ? `0 0 0 4px color-mix(in oklab, ${dotColor} 16%, transparent)` : 'none',
                }}>
                  {st === 'done' ? <Icon name="check" size={11} />
                    : st === 'cancelled' ? <Icon name="x" size={11} />
                    : <Icon name={s.icon} size={11} />}
                </div>
                {!last && <div style={{ width: 2, flex: 1, minHeight: 26, background: lineDone ? 'var(--c-success)' : 'var(--c-border)' }} />}
              </div>
              <div style={{ paddingBottom: last ? 0 : 16, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 13, fontWeight: st === 'active' ? 600 : 500,
                    color: dim ? 'var(--c-text-subtle)' : 'var(--c-text)',
                    textDecoration: st === 'cancelled' ? 'line-through' : 'none',
                  }}>
                    {st === 'done' ? s.done : s.label}
                  </span>
                  {st === 'active' && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: dotColor }}>
                      {isDue ? (overdue ? 'просрочен' : 'наступил') : 'сейчас'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                  {s.managed && <RoleChip role="manager" faded={st !== 'active'} />}
                  {isDue ? (
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: dueOverdue ? 'var(--c-danger)' : 'var(--c-text-muted)' }}>
                      {dueDate}
                    </span>
                  ) : (
                    <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                      {dim ? '—' : (stamps[s.key] ?? '—')}
                    </span>
                  )}
                </div>
                {isDue && duePrev && st !== 'cancelled' && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 11, color: 'var(--c-text-subtle)' }}>
                    <Icon name="history" size={11} />перенесён с {duePrev}
                  </div>
                )}
                {isDue && (st === 'active' || st === 'next') && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 5, fontSize: 11, color: overdue ? 'var(--c-danger)' : 'var(--c-text-subtle)' }}>
                    <Icon name="bell" size={11} />уведомление: Менеджер · Админ
                  </div>
                )}
                {st === 'active' && !isDue && (
                  <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 3 }}>{s.sub}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
