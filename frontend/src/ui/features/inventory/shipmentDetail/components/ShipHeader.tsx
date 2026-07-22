import type { ReactNode } from 'react'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { DocHeader } from '../../../shared/process/DocHeader'
import { shipStatusRole } from '../shared/shipProcess'
import { SHIPMENT_REPACK_KIND_LABELS, SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONES } from '../../../../../api/shipmentsApi'
import type { ShipmentCargoType, ShipmentRepackKind, ShipmentStatus } from '../../../../../api/shipmentsApi'

/** Шапка карточки отгрузки в стиле рейсов: бейдж статуса, приоритет,
 *  «сейчас у: роль», номер (mono) и контекстные действия справа. */
export function ShipHeader({ status, cargoType, title, subtitle, initiator, priority, actions, blockReasons = [], repackKind, repackReason, onBack }: {
  status: ShipmentStatus
  cargoType?: ShipmentCargoType
  title: string
  subtitle?: string
  initiator?: { name?: string | null; createdAt?: string | null }
  priority?: ReactNode
  actions?: ReactNode
  blockReasons?: string[]
  // Бейдж «Переупаковка» живёт с момента запуска и остаётся после завершения задачи.
  repackKind?: ShipmentRepackKind | null
  repackReason?: string | null
  onBack: () => void
}) {
  return (
    <DocHeader
      badges={
        <>
          <Badge tone={SHIPMENT_STATUS_TONES[status] as BadgeTone} dot>
            {SHIPMENT_STATUS_LABELS[status]}
          </Badge>
          {cargoType === 'defect' && <Badge tone="warning">Брак</Badge>}
          {repackKind && (
            <span title={`${SHIPMENT_REPACK_KIND_LABELS[repackKind]}${repackReason ? `: ${repackReason}` : ''}`}>
              <Badge tone="info">Переупаковка</Badge>
            </span>
          )}
          {priority}
        </>
      }
      role={shipStatusRole(status)}
      title={title}
      subtitle={subtitle}
      initiator={initiator}
      actions={actions}
      blockReasons={blockReasons}
      onBack={onBack}
    />
  )
}
