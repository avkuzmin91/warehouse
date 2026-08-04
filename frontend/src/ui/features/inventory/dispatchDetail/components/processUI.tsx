import { Panel } from '../../../shared/process/processUI'
import { ProcessRail } from '../../../shared/process/ProcessRail'
import { buildDispatchSteps } from '../shared/dispatchProcess'
import type { DispatchCargoType, DispatchOp, DispatchStatus } from '../../../../../api/dispatchApi'

export { Panel, ReadRow, ChecklistPanel, LockedGrid } from '../../../shared/process/processUI'
export type { ChecklistItem } from '../../../shared/process/processUI'

/** Панель «Маршрут отгрузки» — вертикальный ProcessRail. Маршрут зависит от типа
 *  груза: брак и годный без упаковки минуют шаг «Ожидание упаковки». */
export function RailPanel({ status, ops, cargoType }: {
  status: DispatchStatus
  ops?: DispatchOp[]
  cargoType?: DispatchCargoType
}) {
  return (
    <Panel icon="truckRoute" title="Маршрут отгрузки" bodyPad={false}>
      <div style={{ padding: '12px 14px' }}>
        <ProcessRail steps={buildDispatchSteps(status, ops, cargoType)} />
      </div>
    </Panel>
  )
}
