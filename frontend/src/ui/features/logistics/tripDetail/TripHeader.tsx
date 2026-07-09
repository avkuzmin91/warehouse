import type { ReactNode } from 'react'
import { Badge } from '../../../primitives/Badge'
import type { BadgeTone } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { tripStatusLabel, tripStatusTone } from '../../../../api/tripsApi'
import type { TripStatus, TripDirection, TripCargoType } from '../../../../api/tripsApi'
import { RoleChip } from '../components/RoleChip'
import type { TripRole } from '../components/RoleChip'
import { InitiatorLine } from '../../shared/process/InitiatorLine'

const STATUS_ROLE: Record<TripStatus, TripRole | null> = {
  draft: 'manager',
  awaiting_arrival: 'warehouse',
  unloading: 'warehouse',
  costing: 'manager',
  closed: null,
  cancelled: null,
}

/** Шапка карточки рейса: номер (mono) + статус + «сейчас у: роль» + контекстное действие. */
export function TripHeader({ number, status, direction = 'inbound', cargoType = 'good', initiator, onBack, action }: {
  number: string
  status: TripStatus
  direction?: TripDirection
  cargoType?: TripCargoType
  initiator?: { name?: string | null; createdAt?: string | null }
  onBack: () => void
  action?: ReactNode
}) {
  const role = STATUS_ROLE[status]
  const outbound = direction === 'outbound'
  const defect = outbound && cargoType === 'defect'
  const subtitle = outbound ? (defect ? 'Рейс отгрузки брака' : 'Рейс отгрузки товара') : 'Рейс поступления'
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
      paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost icon sm" onClick={onBack}><Icon name="arrowLeft" size={14} /></button>
          <Badge tone={tripStatusTone(status) as BadgeTone} dot>{tripStatusLabel(status, direction)}</Badge>
          {defect && <Badge tone="warning">Брак</Badge>}
          {role && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-muted)' }}>
              <span style={{ color: 'var(--c-text-faint)' }}>·</span> сейчас у: <RoleChip role={role} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: 'var(--font-code)' }}>{number}</span>
          <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{subtitle}</span>
        </div>
        {initiator && <InitiatorLine name={initiator.name} createdAt={initiator.createdAt} />}
      </div>
      {action}
    </div>
  )
}
