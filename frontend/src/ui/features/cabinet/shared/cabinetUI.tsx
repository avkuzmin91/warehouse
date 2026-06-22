import type { ReactNode } from 'react'
import type { CabinetCargoType, CabinetReceiptStatus, CabinetShipmentStatus } from '../../../../api/cabinetApi'
import { Icon } from '../../../primitives/Icon'
import { fmtDateTime } from '../../../../utils/format'

// --- Статусный трек документа (горизонтальный степпер) ---

export interface TrackState {
  steps: string[]
  activeIdx: number
}

export function cabinetReceiptTrack(status: CabinetReceiptStatus): TrackState | null {
  if (status === 'cancelled') return null
  const steps = ['Ожидается', 'Приёмка', 'Проверка', 'Принято']
  const idx: Record<Exclude<CabinetReceiptStatus, 'cancelled'>, number> = {
    planned: 0,
    on_intake: 1,
    partially_received: 1,
    on_review: 2,
    done: 3,
  }
  return { steps, activeIdx: idx[status] }
}

export function cabinetShipmentTrack(status: CabinetShipmentStatus, cargoType: CabinetCargoType): TrackState | null {
  if (status === 'cancelled') return null
  if (cargoType === 'defect') {
    const steps = ['Готов к возврату', 'Частично возвращено', 'Возвращено']
    const idx: Record<Exclude<CabinetShipmentStatus, 'cancelled'>, number> = {
      awaiting_trip: 0,
      partially_shipped: 1,
      shipped: 2,
    }
    return { steps, activeIdx: idx[status] }
  }
  const steps = ['Готовится к отправке', 'Частично отгружено', 'Отгружено']
  const idx: Record<Exclude<CabinetShipmentStatus, 'cancelled'>, number> = {
    awaiting_trip: 0,
    partially_shipped: 1,
    shipped: 2,
  }
  return { steps, activeIdx: idx[status] }
}

export function CabinetTrack({ steps, activeIdx }: TrackState) {
  return (
    <div className="ptrack">
      {steps.map((label, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <div className={`ptrack-line${i <= activeIdx ? ' done' : ''}`} />}
          <div className={`ptrack-step${i < activeIdx ? ' done' : ''}${i === activeIdx ? ' active' : ''}`}>
            <div className="ptrack-dot">{i < activeIdx ? <Icon name="check" size={11} /> : i + 1}</div>
            <div className="ptrack-label">{label}</div>
          </div>
        </span>
      ))}
    </div>
  )
}

// --- Лента событий с рельсой ---

export type TimelineTone = '' | 'accent' | 'success' | 'warning' | 'danger'

export interface TimelineItem {
  text: ReactNode
  docNumber?: string
  createdAt: string
  tone?: TimelineTone
  onClick?: () => void
}

export function cabinetOpTone(opType: string): TimelineTone {
  switch (opType) {
    case 'intake_start':
    case 'pack':
      return 'accent'
    case 'arrival_fix':
    case 'pack_correction':
    case 'receiving_correction':
      return 'warning'
    case 'arrival_accept':
    case 'ship':
      return 'success'
    case 'cancel':
      return 'danger'
    default:
      return ''
  }
}

export function CabinetTimeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="tl">
      {items.map((e, i) => (
        <div
          key={i}
          className={`tl-item ${e.tone || ''}${e.onClick ? ' clickable' : ''}`}
          onClick={e.onClick}
        >
          <div className="tl-text">
            {e.docNumber && <span className="mono" style={{ fontWeight: 500, marginRight: 6 }}>{e.docNumber}</span>}
            {e.text}
          </div>
          <div className="tl-time">{fmtDateTime(e.createdAt)}</div>
        </div>
      ))}
    </div>
  )
}

// --- Мини-прогресс в ячейках таблиц ---

export function CellProg({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="prog">
      <i className="prog-fill" style={{ width: `${pct}%`, display: 'block', ...(color ? { background: color } : {}) }} />
    </div>
  )
}
