import type React from 'react'
import {
  SHIPMENT_STATUS_ORDER,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STEP_DONE_LABELS,
} from '../../../api/shipmentsApi'
import type { ShipmentStatus, ShipmentOp } from '../../../api/shipmentsApi'

// advance op записывается при переходе В следующий статус.
// comment содержит "Предыдущий → Следующий", но надёжнее считать по порядку:
// 1-й advance → draft завершён (packing стал активным)
// 2-й advance → packing завершён (ready стал активным)
// 3-й advance → ready завершён (shipped стал активным / финал)
function getStepTimestamps(ops: ShipmentOp[]): Partial<Record<ShipmentStatus | 'cancelled', string>> {
  const ts: Partial<Record<ShipmentStatus | 'cancelled', string>> = {}
  // ops DESC (новые первые) — для каждого типа берём ПЕРВОЕ вхождение
  // чтобы при revert/re-advance показывалось актуальное время
  const advances: string[] = []
  for (const op of [...ops].reverse()) {          // хронологический порядок
    if (op.op_type === 'doc_create' && !ts['draft'])  ts['draft']  = op.created_at
    if (op.op_type === 'advance')                      advances.push(op.created_at)
    if (op.op_type === 'cancel' && !ts['cancelled'])  ts['cancelled'] = op.created_at
  }
  // advance[0] = draft→packing, advance[1] = packing→ready, advance[2] = ready→shipped
  const advanceTargets: ShipmentStatus[] = ['packing', 'ready', 'shipped']
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
  const isCancelled = status === 'cancelled'
  const statusIdx = isCancelled ? 1 : SHIPMENT_STATUS_ORDER.indexOf(status)
  const timestamps = getStepTimestamps(ops)

  return (
    <div className="stepper" style={{ marginBottom: 16, ...style }}>
      {SHIPMENT_STATUS_ORDER.map((s, i) => {
        // --- определяем состояние шага ---
        let stepState: 'done' | 'active' | 'cancelled' | ''
        if (isCancelled) {
          stepState = i === 0 ? 'done' : 'cancelled'
        } else if (status === 'shipped') {
          stepState = 'done'
        } else {
          stepState = i < statusIdx ? 'done' : i === statusIdx ? 'active' : ''
        }

        const isCancelledStep = stepState === 'cancelled'
        const isLastStep = i === SHIPMENT_STATUS_ORDER.length - 1
        const ts = timestamps[s]

        // --- подпись под шагом ---
        let sub = ''
        if (stepState === 'done' && ts)      sub = fmtStepDate(ts)
        else if (stepState === 'active')     sub = 'в процессе'
        else if (isCancelledStep && isLastStep && timestamps['cancelled'])
          sub = fmtStepDate(timestamps['cancelled']!)

        // --- заголовок шага ---
        let title: string
        if (isCancelled && isLastStep) {
          title = 'Отменено'
        } else if (stepState === 'done') {
          title = SHIPMENT_STEP_DONE_LABELS[s]   // «Создан», «Собран», …
        } else {
          title = SHIPMENT_STATUS_LABELS[s]       // «Создание», «Сборка», …
        }

        // --- стили для отменённых шагов ---
        const cancelledNumStyle = isCancelledStep ? {
          background: 'color-mix(in oklab, var(--c-danger) 12%, var(--c-bg))',
          borderColor: 'var(--c-danger)',
          color: 'var(--c-danger)',
        } : undefined
        const cancelledTextStyle = isCancelledStep ? {
          color: isLastStep ? 'var(--c-danger)' : 'var(--c-text-muted)',
        } : undefined

        // className для CSS: 'done' рисует ✓, 'active' — заполненный кружок, '' — пустой
        return (
          <div key={s} className={`step ${isCancelledStep ? 'done' : stepState}`}>
            <div className="row gap-8">
              <div className="step-num" style={cancelledNumStyle}>
                {stepState === 'done'
                  ? <StepDoneIcon />
                  : isCancelledStep
                  ? <StepCancelIcon />
                  : stepState === 'active'
                  ? <StepActiveIcon />
                  : <StepFutureIcon />}
              </div>
              <span className="step-value" style={cancelledTextStyle}>{title}</span>
            </div>
            <div className="step-label">{sub || ' '}</div>
          </div>
        )
      })}
    </div>
  )
}

// Иконки по ТЗ: ✓ / ● / ○ / ✗
function StepDoneIcon()   { return <span style={{ fontSize: 11, fontWeight: 700 }}>✓</span> }
function StepActiveIcon() { return <span style={{ fontSize: 11 }}>●</span> }
function StepFutureIcon() { return <span style={{ fontSize: 11, opacity: 0.4 }}>○</span> }
function StepCancelIcon() { return <span style={{ fontSize: 11, fontWeight: 700 }}>✗</span> }
