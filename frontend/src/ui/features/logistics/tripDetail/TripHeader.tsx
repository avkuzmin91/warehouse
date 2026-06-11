import type { ReactNode } from 'react'
import { Badge } from '../../../primitives/Badge'
import type { BadgeTone } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { tripStatusLabel, tripStatusTone } from '../../../../api/tripsApi'
import type { TripStatus, TripDirection } from '../../../../api/tripsApi'
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
export function TripHeader({ number, status, direction = 'inbound', onBack, action }: {
  number: string
  status: TripStatus
  direction?: TripDirection
  onBack: () => void
  action?: ReactNode
}) {
  const role = STATUS_ROLE[status]
  const outbound = direction === 'outbound'
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
      paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost icon sm" onClick={onBack}><Icon name="arrowLeft" size={14} /></button>
          <Badge tone={tripStatusTone(status) as BadgeTone} dot>{tripStatusLabel(status, direction)}</Badge>
          {role && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-muted)' }}>
              <span style={{ color: 'var(--c-text-faint)' }}>·</span> сейчас у: <RoleChip role={role} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: 'var(--font-code)' }}>{number}</span>
          <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{outbound ? 'Рейс отгрузки' : 'Рейс поступления'}</span>
        </div>
      </div>
      {action}
    </div>
  )
}
