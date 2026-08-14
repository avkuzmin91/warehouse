import {
  RECEIPT_STATUS_ORDER,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STEP_DONE_LABELS,
} from '../../../../../api/receiptsApi'
import type { ReceiptOp, ReceiptStatus } from '../../../../../api/receiptsApi'
import type { ProcessStep } from '../../../shared/process/ProcessRail'
import type { ProcessRole } from '../../../shared/process/roles'
import { MOSCOW_TZ, parseMoscow } from '../../../../../utils/format'
import type { IconName } from '../../../../primitives/Icon'

/** Маршрут поступления: владелец, иконка и подсказка для каждого статуса.
 *  Приёмка идёт рейсом, поэтому средний шаг — событие разгрузки рейса (роль склада). */
export const RC_META: Record<ReceiptStatus, { role: ProcessRole | null; icon: IconName; sub: string }> = {
  draft:     { role: 'manager',   icon: 'edit',     sub: 'состав и план поступления' },
  planned:   { role: 'manager',   icon: 'clock',    sub: 'ожидание приёмки рейсом' },
  partially_received: { role: 'warehouse', icon: 'forklift', sub: 'часть принята рейсами, остаток ждёт следующих' },
  done:      { role: null,        icon: 'check',    sub: 'товар встал на остатки годным' },
  cancelled: { role: null,        icon: 'x',        sub: '' },
}

/** Роль-владелец текущего шага (для «сейчас у:» в шапке).
 *  При ожидании рейса ход не у человека, а у события разгрузки — роль не показываем. */
export function receiptStatusRole(status: ReceiptStatus, awaitingTrip = false): ProcessRole | null {
  if (awaitingTrip) return null
  return RC_META[status]?.role ?? null
}

// receipt_ops → статус, для которого это отметка времени.
// ops приходят DESC (новые первые) — берём первое вхождение каждого типа.
function getStepTimestamps(ops: ReceiptOp[]): Partial<Record<ReceiptStatus, string>> {
  const ts: Partial<Record<ReceiptStatus, string>> = {}
  for (const op of ops) {
    if (op.op_type === 'doc_create' && !ts.draft) ts.draft = op.created_at
    else if (op.op_type === 'plan_fix' && !ts.planned) ts.planned = op.created_at
    else if (op.op_type === 'arrival_accept' && !ts.partially_received) ts.partially_received = op.created_at
    else if (op.op_type === 'arrival_fix' && !ts.done) ts.done = op.created_at
  }
  return ts
}

function fmt(s: string): string {
  const d = parseMoscow(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MOSCOW_TZ })
}

/** Шаги маршрута поступления для ProcessRail. При привязке к рейсу шаг
 *  «В плане» поясняет, что приёмка стартует разгрузкой рейса. */
export function buildReceiptSteps(
  status: ReceiptStatus,
  ops: ReceiptOp[] = [],
  opts: { awaitingTrip?: boolean; tripNumber?: string | null } = {},
): ProcessStep[] {
  const isDone = status === 'done'
  const curIdx = status === 'cancelled' ? 1 : RECEIPT_STATUS_ORDER.indexOf(status)
  const ts = getStepTimestamps(ops)
  return RECEIPT_STATUS_ORDER.map((s, i) => {
    const state: ProcessStep['state'] = isDone || i < curIdx ? 'done' : i === curIdx ? 'active' : 'future'
    const m = RC_META[s]
    const awaiting = s === 'planned' && opts.awaitingTrip
    return {
      key: s,
      title: state === 'done' ? RECEIPT_STEP_DONE_LABELS[s] : RECEIPT_STATUS_LABELS[s],
      role: m.role,
      icon: awaiting ? 'truckIn' : m.icon,
      state,
      time: ts[s] ? fmt(ts[s]!) : null,
      sub: awaiting
        ? `приёмка начнётся при разгрузке рейса ${opts.tripNumber ?? ''}`.trim()
        : m.sub,
    }
  })
}
