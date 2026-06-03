import type React from 'react'
import { Icon } from '../../primitives/Icon'
import {
  RECEIPT_STATUS_ORDER,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STEP_DONE_LABELS,
} from '../../../api/receiptsApi'
import type { ReceiptOp, ReceiptStatus } from '../../../api/receiptsApi'

// Индекс шага, на котором произошло аннулирование (planned = 1)
const CANCELLED_AT_IDX = 1

function fmtStepDate(s: string) {
  return new Date(s).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function getStatusTimestamps(ops: ReceiptOp[]): Partial<Record<ReceiptStatus | 'cancelled', string>> {
  // ops приходят DESC (новые первые) — берём первое вхождение каждого типа,
  // чтобы при reopen/redo показывалось актуальное время
  const ts: Partial<Record<ReceiptStatus | 'cancelled', string>> = {}
  for (const op of ops) {
    if (op.op_type === 'doc_create' && !ts['draft']) ts['draft'] = op.created_at
    else if (op.op_type === 'plan_fix' && !ts['planned']) ts['planned'] = op.created_at
    else if (op.op_type === 'intake_start' && !ts['on_intake']) ts['on_intake'] = op.created_at
    else if (op.op_type === 'arrival_fix' && !ts['on_review']) ts['on_review'] = op.created_at
    else if (op.op_type === 'qc_complete') {
      // qc_complete всегда перебивает arrival_fix для шага "Проверен"
      ts['on_review'] = op.created_at
      if (!ts['done']) ts['done'] = op.created_at
    }
    else if (op.op_type === 'cancel' && !ts['cancelled']) ts['cancelled'] = op.created_at
  }
  return ts
}

interface Props {
  status: ReceiptStatus
  ops?: ReceiptOp[]
  style?: React.CSSProperties
}

export function ReceiptStepper({ status, ops = [], style }: Props) {
  const isCancelled = status === 'cancelled'
  const statusIdx = isCancelled ? CANCELLED_AT_IDX : RECEIPT_STATUS_ORDER.indexOf(status)
  const timestamps = getStatusTimestamps(ops)
  const cancelledAt = timestamps['cancelled']

  return (
    <div className="stepper" style={{ marginBottom: 16, ...style }}>
      {RECEIPT_STATUS_ORDER.map((s, i) => {
        let stepState: 'done' | 'active' | 'cancelled' | ''

        if (isCancelled) {
          if (i < CANCELLED_AT_IDX) stepState = 'done'
          else stepState = 'cancelled'
        } else if (status === 'done') {
          stepState = 'done'
        } else {
          stepState = i < statusIdx ? 'done' : i === statusIdx ? 'active' : ''
        }

        const ts = timestamps[s]

        const isCancelledStep = stepState === 'cancelled'
        // Последний шаг в cancelled — показывает дату и заголовок "Аннулирован"
        const isLastStep = i === RECEIPT_STATUS_ORDER.length - 1

        let label = ''
        if (stepState === 'done') {
          label = ts ? fmtStepDate(ts) : ''
        } else if (stepState === 'active') {
          label = ts ? fmtStepDate(ts) : 'в процессе'
        } else if (isCancelledStep && isLastStep && cancelledAt) {
          label = fmtStepDate(cancelledAt)
        }

        let stepTitle: string
        if (isCancelled && isLastStep) {
          stepTitle = 'Аннулирован'
        } else if (stepState === 'done') {
          stepTitle = RECEIPT_STEP_DONE_LABELS[s]
        } else {
          stepTitle = RECEIPT_STATUS_LABELS[s]
        }

        const cancelledStepNumStyle = isCancelledStep ? {
          background: 'color-mix(in oklab, var(--c-danger) 12%, var(--c-bg))',
          borderColor: 'var(--c-danger)',
          color: 'var(--c-danger)',
        } : undefined

        const cancelledStepTextStyle = isCancelledStep ? {
          color: isLastStep ? 'var(--c-danger)' : 'var(--c-text-muted)',
        } : undefined

        return (
          <div key={s} className={`step ${isCancelledStep ? 'done' : stepState}`}>
            <div className="row gap-8">
              <div className="step-num" style={cancelledStepNumStyle}>
                {stepState === 'done' ? <Icon name="check" size={11} />
                  : isCancelledStep ? <Icon name="x" size={11} />
                  : i + 1}
              </div>
              <span className="step-value" style={cancelledStepTextStyle}>{stepTitle}</span>
            </div>
            <div className="step-label">{label || ' '}</div>
          </div>
        )
      })}
    </div>
  )
}
