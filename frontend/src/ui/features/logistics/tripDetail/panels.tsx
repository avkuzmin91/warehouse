import type { ReactNode } from 'react'
import { Icon } from '../../../primitives/Icon'
import type { IconName } from '../../../primitives/Icon'
import type { TripOp, TripStatus } from '../../../../api/tripsApi'
import { ProcessRail } from '../components/ProcessRail'
import { CostLedger } from '../components/CostLedger'
import { OpEntry } from './components/OpEntry'

/** Карточка-обёртка (по образцу .card / .card-head проекта). */
export function Panel({ icon, iconColor = 'var(--c-accent)', title, right, children, bodyPad = true }: {
  icon?: IconName
  iconColor?: string
  title: string
  right?: ReactNode
  children: ReactNode
  bodyPad?: boolean
}) {
  return (
    <div className="card">
      <div className="card-head">
        {icon && <Icon name={icon} size={15} style={{ color: iconColor }} />}
        <span className="card-head-title">{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ padding: bodyPad ? 14 : 0 }}>{children}</div>
    </div>
  )
}

export function ProcessPanel({ status, ops, direction }: { status: TripStatus; ops: TripOp[]; direction?: string | null }) {
  return (
    <Panel icon="layers" title="Процесс рейса" bodyPad={false}>
      <div style={{ padding: '12px 14px' }}>
        <ProcessRail status={status} ops={ops} direction={direction} />
      </div>
    </Panel>
  )
}

export function CostPanel({ estimate, actual, waiting, showActual }: {
  estimate: number | null
  actual?: number | null
  waiting?: number | null
  showActual?: boolean
}) {
  return (
    <Panel icon="ruble" title="Стоимость">
      <CostLedger estimate={estimate} actual={actual} waiting={waiting} showActual={showActual} />
    </Panel>
  )
}

export function JournalPanel({ ops }: { ops: TripOp[] }) {
  return (
    <Panel icon="layers" title="Журнал" right={ops.length > 0 ? <span className="t-sub">{ops.length}</span> : undefined} bodyPad={false}>
      {ops.length === 0 ? (
        <div className="t-sub" style={{ padding: 14 }}>Нет операций</div>
      ) : (
        <div style={{ padding: '6px 14px 10px' }}>
          {ops.map((op) => (
            <OpEntry key={op.id} op={op} />
          ))}
        </div>
      )}
    </Panel>
  )
}

export type Check = { ok: boolean; label: string }

/** Компактный чеклист «Готово к передаче» (draft). Заменяет карточку TripReadiness. */
export function ReadyChecklist({ checks, title = 'Готово к передаче' }: { checks: Check[]; title?: string }) {
  const allOk = checks.every((c) => c.ok)
  return (
    <Panel icon={allOk ? 'check' : undefined} iconColor="var(--c-success)" title={title} bodyPad={false}>
      <div className="readiness-list">
        {checks.map((c, i) => (
          <div key={i} className="readiness-row">
            {c.ok ? (
              <div className="readiness-dot ok"><Icon name="check" size={10} /></div>
            ) : (
              <div className="readiness-dot pending" />
            )}
            <span className={`readiness-label ${c.ok ? 'ok' : 'pending'}`}>{c.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
