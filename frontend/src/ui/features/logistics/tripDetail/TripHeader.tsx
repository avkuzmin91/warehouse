import type { ReactNode } from 'react'
import { Badge } from '../../../primitives/Badge'
import type { BadgeTone } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { TRIP_STATUS_LABELS, tripStatusTone } from '../../../../api/tripsApi'
import type { TripStatus } from '../../../../api/tripsApi'
import { RoleChip } from '../components/RoleChip'
import type { TripRole } from '../components/RoleChip'

const STATUS_ROLE: Record<TripStatus, TripRole | null> = {
  draft: 'manager',
  awaiting_arrival: 'warehouse',
  unloading: 'warehouse',
  costing: 'manager',
  closed: null,
  cancelled: null,
}

/** Шапка карточки рейса: номер (mono) + статус + «сейчас у: роль» + контекстное действие. */
export function TripHeader({ number, status, onBack, action }: {
  number: string
  status: TripStatus
  onBack: () => void
  action?: ReactNode
}) {
  const role = STATUS_ROLE[status]
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
      paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost icon sm" onClick={onBack}><Icon name="arrowLeft" size={14} /></button>
          <Badge tone={tripStatusTone(status) as BadgeTone} dot>{TRIP_STATUS_LABELS[status]}</Badge>
          {role && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-muted)' }}>
              <span style={{ color: 'var(--c-text-faint)' }}>·</span> сейчас у: <RoleChip role={role} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: 'var(--font-mono)' }}>{number}</span>
          <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>Рейс поступления</span>
        </div>
      </div>
      {action}
    </div>
  )
}

/** Контекстная главная кнопка + подсказка о передаче. */
export function PrimaryAction({ icon, label, hint, onClick, disabled }: {
  icon: Parameters<typeof Icon>[0]['name']
  label: string
  hint?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button className="btn lg primary" onClick={onClick} disabled={disabled}>
        <Icon name={icon} size={15} />{label}
      </button>
      {hint && <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', textAlign: 'right' }}>{hint}</span>}
    </div>
  )
}
