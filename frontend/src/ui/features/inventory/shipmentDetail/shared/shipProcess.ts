import {
  SHIPMENT_STATUS_ORDER,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STEP_DONE_LABELS,
} from '../../../../../api/shipmentsApi'
import type { ShipmentCargoType, ShipmentOp, ShipmentStatus } from '../../../../../api/shipmentsApi'
import type { ProcessStep } from '../../../shared/process/ProcessRail'
import type { ProcessRole } from '../../../shared/process/RoleChip'
import type { IconName } from '../../../../primitives/Icon'

/** Маршрут отгрузки: владелец, иконка и подсказка для каждого статуса. */
export const SH_META: Record<ShipmentStatus, { role: ProcessRole | null; icon: IconName; sub: string }> = {
  draft:         { role: 'manager',    icon: 'edit',     sub: 'состав, ТЗ и план' },
  packing:       { role: 'warehouse',  icon: 'forklift', sub: 'передача товара на упаковку' },
  on_packing:    { role: 'shift_lead', icon: 'box',      sub: 'внесение годного и брака' },
  relocating:    { role: 'warehouse',  icon: 'archive',  sub: 'раскладка по местоположениям' },
  awaiting_trip: { role: 'manager',    icon: 'clock',    sub: 'привязка и отправка рейса' },
  shipped:       { role: null,         icon: 'truckOut', sub: 'списан при отправке рейса' },
  cancelled:     { role: null,         icon: 'x',        sub: '' },
}

/** Роль-владелец текущего шага (для «сейчас у:» в шапке). */
export function shipStatusRole(status: ShipmentStatus): ProcessRole | null {
  return SH_META[status]?.role ?? null
}

// shipment_ops → статус, для которого это отметка времени.
function getStepTimestamps(ops: ShipmentOp[]): Partial<Record<ShipmentStatus, string>> {
  const ts: Partial<Record<ShipmentStatus, string>> = {}
  for (const op of [...ops].reverse()) {
    if (op.op_type === 'doc_create' && !ts.draft) ts.draft = op.created_at
    if (op.op_type !== 'advance') continue
    const comment = op.comment ?? ''
    for (const s of SHIPMENT_STATUS_ORDER) {
      if (s === 'draft') continue
      if (!ts[s] && (comment.includes(`→ ${s}`) || comment.includes(`-> ${s}`))) {
        ts[s] = op.created_at
      }
    }
  }
  return ts
}

function fmt(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Брак-отгрузка минует упаковку: укороченный маршрут со своими подсказками.
const DEFECT_STATUS_ORDER: ShipmentStatus[] = ['draft', 'relocating', 'awaiting_trip', 'shipped']
const SH_META_DEFECT: Partial<Record<ShipmentStatus, { role: ProcessRole | null; icon: IconName; sub: string; doneTitle?: string }>> = {
  draft:         { role: 'manager',   icon: 'edit',     sub: 'состав и план брака' },
  relocating:    { role: 'warehouse', icon: 'archive',  sub: 'подготовка брака в зону отгрузки', doneTitle: 'Подготовлен к рейсу' },
  awaiting_trip: { role: 'manager',   icon: 'clock',    sub: 'привязка и отправка рейса' },
  shipped:       { role: null,        icon: 'truckOut', sub: 'списан при отправке рейса' },
}

/** Шаги маршрута отгрузки для ProcessRail. */
export function buildShipSteps(status: ShipmentStatus, ops: ShipmentOp[] = [], cargoType: ShipmentCargoType = 'good'): ProcessStep[] {
  const order = cargoType === 'defect' ? DEFECT_STATUS_ORDER : SHIPMENT_STATUS_ORDER
  const isShipped = status === 'shipped'
  const curIdx = status === 'cancelled' ? 1 : order.indexOf(status)
  const ts = getStepTimestamps(ops)
  return order.map((s, i) => {
    const state: ProcessStep['state'] = isShipped || i < curIdx ? 'done' : i === curIdx ? 'active' : 'future'
    const m = (cargoType === 'defect' ? SH_META_DEFECT[s] : undefined) ?? SH_META[s]
    const doneTitle = (cargoType === 'defect' ? SH_META_DEFECT[s]?.doneTitle : undefined) ?? SHIPMENT_STEP_DONE_LABELS[s]
    return {
      key: s,
      title: state === 'done' ? doneTitle : SHIPMENT_STATUS_LABELS[s],
      role: m.role,
      icon: m.icon,
      state,
      time: ts[s] ? fmt(ts[s]!) : null,
      sub: m.sub,
    }
  })
}
