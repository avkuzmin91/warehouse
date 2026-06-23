import {
  DISPATCH_STATUS_LABELS,
} from '../../../../../api/dispatchApi'
import type { DispatchOp, DispatchStatus } from '../../../../../api/dispatchApi'
import type { ProcessStep } from '../../../shared/process/ProcessRail'
import type { ProcessRole } from '../../../shared/process/RoleChip'
import type { IconName } from '../../../../primitives/Icon'

/** Маршрут отгрузки (DSP): владелец, иконка и подсказка для каждого статуса. */
const DSP_META: Record<DispatchStatus, { role: ProcessRole | null; icon: IconName; sub: string; doneTitle: string }> = {
  draft:             { role: 'manager',   icon: 'edit',     sub: 'состав, ссылки и план',          doneTitle: 'Создано' },
  preparing:         { role: 'warehouse', icon: 'forklift', sub: 'кладовщик готовит отгрузку',      doneTitle: 'Подготовлено' },
  awaiting_trip:     { role: 'manager',   icon: 'clock',    sub: 'привязка и отправка рейса',       doneTitle: 'Готово к рейсу' },
  partially_shipped: { role: 'manager',   icon: 'truckOut', sub: 'часть уехала, остаток ждёт рейс', doneTitle: 'Часть отгружена' },
  shipped:           { role: null,        icon: 'truckOut', sub: 'списано при отправке рейса',      doneTitle: 'Отгружено' },
  cancelled:         { role: null,        icon: 'x',        sub: '',                                doneTitle: 'Аннулирована' },
}

/** Линейный маршрут DSP для ProcessRail (без отмены). */
const DSP_STATUS_ORDER: DispatchStatus[] = ['draft', 'preparing', 'awaiting_trip', 'partially_shipped', 'shipped']

/** Роль-владелец текущего шага (для «сейчас у:» в шапке). */
export function dispatchStatusRole(status: DispatchStatus): ProcessRole | null {
  return DSP_META[status]?.role ?? null
}

// dispatch_ops → статус, для которого это отметка времени.
function getStepTimestamps(ops: DispatchOp[]): Partial<Record<DispatchStatus, string>> {
  const ts: Partial<Record<DispatchStatus, string>> = {}
  for (const op of [...ops].reverse()) {
    if (op.op_type === 'doc_create' && !ts.draft) ts.draft = op.created_at
    if (op.op_type === 'advance' && !ts.preparing) ts.preparing = op.created_at
    if (op.op_type === 'prepare' && !ts.awaiting_trip) ts.awaiting_trip = op.created_at
    if (op.op_type === 'ship') {
      // Первая отгрузка по рейсу — отметка «частично», последняя — «отгружено».
      if (!ts.partially_shipped) ts.partially_shipped = op.created_at
      ts.shipped = op.created_at
    }
  }
  return ts
}

function fmt(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Шаги маршрута отгрузки (DSP) для ProcessRail. */
export function buildDispatchSteps(status: DispatchStatus, ops: DispatchOp[] = []): ProcessStep[] {
  const isShipped = status === 'shipped'
  const isCancelled = status === 'cancelled'
  // «Частично отгружено» есть в линейном маршруте; для индекса используем его напрямую.
  const curIdx = DSP_STATUS_ORDER.indexOf(status)
  const ts = getStepTimestamps(ops)
  const reachedIdx = isCancelled
    ? DSP_STATUS_ORDER.reduce((max, s, i) => (ts[s] != null ? i : max), 0)
    : -1
  return DSP_STATUS_ORDER.map((s, i) => {
    const state: ProcessStep['state'] = isShipped
      ? 'done'
      : isCancelled
        ? (i <= reachedIdx ? 'done' : 'future')
        : i < curIdx ? 'done' : i === curIdx ? 'active' : 'future'
    const m = DSP_META[s]
    return {
      key: s,
      title: state === 'done' ? m.doneTitle : DISPATCH_STATUS_LABELS[s],
      role: m.role,
      icon: m.icon,
      state,
      time: ts[s] ? fmt(ts[s]!) : null,
      sub: m.sub,
    }
  })
}
