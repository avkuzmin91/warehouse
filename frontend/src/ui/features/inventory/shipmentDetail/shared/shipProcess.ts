import {
  SHIPMENT_STATUS_ORDER,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STEP_DONE_LABELS,
} from '../../../../../api/shipmentsApi'
import type { ShipmentCargoType, ShipmentOp, ShipmentStatus } from '../../../../../api/shipmentsApi'
import type { ProcessStep } from '../../../shared/process/ProcessRail'
import type { ProcessRole } from '../../../shared/process/RoleChip'
import { MOSCOW_TZ, parseMoscow } from '../../../../../utils/format'
import type { IconName } from '../../../../primitives/Icon'

/** Маршрут отгрузки: владелец, иконка и подсказка для каждого статуса. */
export const SH_META: Record<ShipmentStatus, { role: ProcessRole | null; icon: IconName; sub: string }> = {
  draft:         { role: 'manager',    icon: 'edit',     sub: 'состав, ТЗ и план' },
  packing:       { role: 'warehouse',  icon: 'forklift', sub: 'передача товара на упаковку' },
  on_packing:    { role: 'shift_lead', icon: 'box',      sub: 'внесение годного и брака' },
  relocating:    { role: 'warehouse',  icon: 'archive',  sub: 'раскладка по местоположениям' },
  packed:        { role: null,         icon: 'check',    sub: 'товар упакован и разложен' },
  // Легаси-статусы (исторические документы): в новом маршруте упаковки не используются.
  awaiting_trip: { role: 'manager',    icon: 'clock',    sub: 'привязка и отправка рейса' },
  partially_shipped: { role: 'manager', icon: 'truckOut', sub: 'часть уехала, остаток ждёт рейс' },
  shipped:       { role: null,         icon: 'truckOut', sub: 'списан при отправке рейса' },
  completed_no_goods: { role: null,    icon: 'check',    sub: 'завершено без отгрузки: весь товар брак' },
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
    // Раскладка/подготовка («relocate») переводит документ в «Упаковано»,
    // но это не 'advance'-операция — фиксируем отметку отдельно.
    if (op.op_type === 'relocate' && !ts.packed) ts.packed = op.created_at
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
  const d = parseMoscow(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MOSCOW_TZ })
}

// Брак-отгрузка минует упаковку: укороченный маршрут со своими подсказками.
const DEFECT_STATUS_ORDER: ShipmentStatus[] = ['draft', 'relocating', 'packed']
const SH_META_DEFECT: Partial<Record<ShipmentStatus, { role: ProcessRole | null; icon: IconName; sub: string; doneTitle?: string }>> = {
  draft:         { role: 'manager',   icon: 'edit',     sub: 'состав и план брака' },
  relocating:    { role: 'warehouse', icon: 'archive',  sub: 'подготовка брака в зону отгрузки', doneTitle: 'Подготовлен' },
  packed:        { role: null,        icon: 'check',    sub: 'брак подготовлен' },
}

/** Шаги маршрута отгрузки для ProcessRail. */
export function buildShipSteps(status: ShipmentStatus, ops: ShipmentOp[] = [], cargoType: ShipmentCargoType = 'good'): ProcessStep[] {
  const order = cargoType === 'defect' ? DEFECT_STATUS_ORDER : SHIPMENT_STATUS_ORDER
  // «Завершено без отгрузки» (весь товар брак) — терминал: маршрут пройден целиком.
  // Легаси-статусы рейса (shipped/partially/awaiting_trip) для исторических документов
  // считаем пройденным маршрутом — задача упаковки в них уже завершена.
  const isShipped = status === 'shipped' || status === 'completed_no_goods'
    || status === 'partially_shipped' || status === 'awaiting_trip'
  const isCancelled = status === 'cancelled'
  const railStatus: ShipmentStatus = status
  const curIdx = order.indexOf(railStatus)
  const ts = getStepTimestamps(ops)
  // У аннулированного «текущего» шага нет: отмену можно сделать с разных этапов
  // (вплоть до «Ожидает рейс»). Показываем реально пройденный путь по отметкам
  // журнала как done, без активного шага — иначе линия выглядит как «сейчас в плане».
  const reachedIdx = isCancelled
    ? order.reduce((max, s, i) => (ts[s] != null ? i : max), 0)
    : -1
  return order.map((s, i) => {
    const state: ProcessStep['state'] = isShipped
      ? 'done'
      : isCancelled
        ? (i <= reachedIdx ? 'done' : 'future')
        : i < curIdx ? 'done' : i === curIdx ? 'active' : 'future'
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
