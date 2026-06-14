import { Panel } from '../../../shared/process/processUI'
import { ProcessRail } from '../../../shared/process/ProcessRail'
import { buildReceiptSteps } from '../shared/receiptProcess'
import type { ReceiptOp, ReceiptStatus } from '../../../../../api/receiptsApi'

/** Панель «Маршрут поступления» — вертикальный ProcessRail. */
export function ReceiptRailPanel({ status, ops, awaitingTrip, tripNumber }: {
  status: ReceiptStatus
  ops?: ReceiptOp[]
  awaitingTrip?: boolean
  tripNumber?: string | null
}) {
  return (
    <Panel icon="truckRoute" title="Маршрут поступления" bodyPad={false}>
      <div style={{ padding: '12px 14px' }}>
        <ProcessRail steps={buildReceiptSteps(status, ops, { awaitingTrip, tripNumber })} />
      </div>
    </Panel>
  )
}
