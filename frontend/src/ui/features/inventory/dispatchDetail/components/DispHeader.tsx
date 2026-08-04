import type { ReactNode } from 'react'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { DocHeader } from '../../../shared/process/DocHeader'
import { dispatchStatusRole } from '../shared/dispatchProcess'
import { DISPATCH_STATUS_LABELS, DISPATCH_STATUS_TONES } from '../../../../../api/dispatchApi'
import type { DispatchCargoType, DispatchStatus } from '../../../../../api/dispatchApi'

/** Шапка карточки отгрузки (DSP): бейдж статуса, «Брак», приоритет,
 *  «сейчас у: роль», номер (mono) и контекстные действия справа. */
export function DispHeader({ status, cargoType, title, subtitle, initiator, priority, actions, blockReasons = [], onBack }: {
  status: DispatchStatus
  cargoType?: DispatchCargoType
  title: string
  subtitle?: string
  initiator?: { name?: string | null; createdAt?: string | null }
  priority?: ReactNode
  actions?: ReactNode
  blockReasons?: string[]
  onBack: () => void
}) {
  return (
    <DocHeader
      badges={
        <>
          <Badge tone={DISPATCH_STATUS_TONES[status] as BadgeTone} dot>
            {DISPATCH_STATUS_LABELS[status]}
          </Badge>
          {cargoType === 'defect' && <Badge tone="warning">Брак</Badge>}
          {cargoType === 'good_unpacked' && <Badge>Без упаковки</Badge>}
          {priority}
        </>
      }
      role={dispatchStatusRole(status)}
      title={title}
      subtitle={subtitle}
      initiator={initiator}
      actions={actions}
      blockReasons={blockReasons}
      onBack={onBack}
    />
  )
}
