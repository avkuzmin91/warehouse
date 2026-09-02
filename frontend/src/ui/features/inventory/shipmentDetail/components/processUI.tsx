import { Panel } from '../../../shared/process/processUI'
import { ProcessRail } from '../../../shared/process/ProcessRail'
import { buildShipSteps } from '../shared/shipProcess'
import type { ShipmentCargoType, ShipmentOp, ShipmentStatus, ShipmentTaskKind } from '../../../../../api/shipmentsApi'

export { Panel, ReadRow, ChecklistPanel, LockedGrid } from '../../../shared/process/processUI'
export type { ChecklistItem } from '../../../shared/process/processUI'

/** Панель «Маршрут отгрузки» — вертикальный ProcessRail. */
export function RailPanel({ status, ops, cargoType = 'good', taskKind = 'packing' }: {
  status: ShipmentStatus
  ops?: ShipmentOp[]
  cargoType?: ShipmentCargoType
  taskKind?: ShipmentTaskKind
}) {
  return (
    <Panel icon="truckRoute" title={taskKind === 'putaway' ? 'Маршрут размещения' : 'Маршрут отгрузки'} bodyPad={false}>
      <div style={{ padding: '12px 14px' }}>
        <ProcessRail steps={buildShipSteps(status, ops, cargoType, taskKind)} />
      </div>
    </Panel>
  )
}
