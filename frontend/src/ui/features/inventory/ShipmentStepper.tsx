import type React from 'react'
import { Icon } from '../../primitives/Icon'
import {
  SHIPMENT_STATUS_ORDER,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STEP_DONE_LABELS,
} from '../../../api/shipmentsApi'
import type { ShipmentOp, ShipmentStatus } from '../../../api/shipmentsApi'

function getStepTimestamps(ops: ShipmentOp[]): Partial<Record<ShipmentStatus, string>> {
  const ts: Partial<Record<ShipmentStatus, string>> = {}
  const advances: string[] = []

  for (const op of [...ops].reverse()) {
    if (op.op_type === 'doc_create' && !ts.draft) ts.draft = op.created_at
    if (op.op_type !== 'advance') continue

    const comment = op.comment ?? ''
    if (comment.includes('→ shipped') || comment.includes('-> shipped')) {
      ts.shipped = op.created_at
    } else if (comment.includes('→ packing') || comment.includes('-> packing')) {
      ts.packing = op.created_at
    } else {
      advances.push(op.created_at)
    }
  }

  const advanceTargets: ShipmentStatus[] = ['packing', 'shipped']
  advances.forEach((at, i) => {
    const key = advanceTargets[i]
    if (key && !ts[key]) ts[key] = at
  })

  return ts
}

function fmtStepDate(s: string) {
  return new Date(s).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  status: ShipmentStatus
  ops?: ShipmentOp[]
  style?: React.CSSProperties
}

export function ShipmentStepper({ status, ops = [], style }: Props) {
  const statusIdx = status === 'cancelled' ? 1 : SHIPMENT_STATUS_ORDER.indexOf(status)
  const timestamps = getStepTimestamps(ops)
  const isShipped = status === 'shipped'

  return (
    <div className="stepper" style={{ marginBottom: 16, ...style }}>
      {SHIPMENT_STATUS_ORDER.map((s, i) => {
        let stepState: 'done' | 'active' | ''
        if (isShipped) {
          stepState = 'done'
        } else {
          stepState = i < statusIdx ? 'done' : i === statusIdx ? 'active' : ''
        }

        const ts = timestamps[s]
        let sub = ''
        if (stepState === 'done' && ts) sub = fmtStepDate(ts)
        else if (stepState === 'active') sub = 'в процессе'

        const title = stepState === 'done' ? SHIPMENT_STEP_DONE_LABELS[s] : SHIPMENT_STATUS_LABELS[s]

        return (
          <div key={s} className={`step ${stepState}`}>
            <div className="row gap-8">
              <div className="step-num">
                {stepState === 'done' ? <Icon name="check" size={11} /> : i + 1}
              </div>
              <span className="step-value">{title}</span>
            </div>
            <div className="step-label">{sub || ' '}</div>
          </div>
        )
      })}
    </div>
  )
}
