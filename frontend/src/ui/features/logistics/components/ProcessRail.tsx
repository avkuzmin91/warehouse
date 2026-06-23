import { ProcessRail as ProcessRailView } from '../../shared/process/ProcessRail'
import type { ProcessStep } from '../../shared/process/ProcessRail'
import type { ProcessRole } from '../../shared/process/RoleChip'
import type { IconName } from '../../../primitives/Icon'
import { isOutbound } from '../../../../api/tripsApi'
import type { TripOp, TripStatus } from '../../../../api/tripsApi'
import { MOSCOW_TZ, parseMoscow } from '../../../../utils/format'

/** Вертикальный таймлайн фаз рейса. Заменяет горизонтальный TripStepper. */

const STATUS_ORDER: TripStatus[] = ['draft', 'awaiting_arrival', 'unloading', 'costing', 'closed']

const META: Record<string, { title: string; role: ProcessRole | null; icon: IconName }> = {
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
  const d = parseMoscow(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: MOSCOW_TZ })
}

export function ProcessRail({ status, ops = [], direction }: { status: TripStatus; ops?: TripOp[]; direction?: string | null }) {
  const cancelled = status === 'cancelled'
  const curIdx = cancelled ? 1 : STATUS_ORDER.indexOf(status)
  const ts = getTimestamps(ops)
  const outbound = isOutbound(direction)
  const titleFor = (s: TripStatus): string => {
    if (outbound && s === 'unloading') return 'Погрузка'
    return META[s].title
  }

  const steps: ProcessStep[] = STATUS_ORDER.map((s, i) => {
    const m = META[s]
    return {
      key: s,
      title: titleFor(s),
      role: m.role,
      icon: m.icon,
      state: i < curIdx ? 'done' : i === curIdx ? 'active' : 'future',
      time: ts[s] ? fmt(ts[s]!) : null,
    }
  })

  return <ProcessRailView steps={steps} />
}
