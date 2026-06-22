import { Panel } from '../../../shared/process/processUI'
import { ProcessRail } from '../../../shared/process/ProcessRail'
import { buildDispatchSteps } from '../shared/dispatchProcess'
import type { DispatchOp, DispatchStatus } from '../../../../../api/dispatchApi'

export { Panel, ReadRow, ChecklistPanel, LockedGrid } from '../../../shared/process/processUI'
export type { ChecklistItem } from '../../../shared/process/processUI'

/** Панель «Маршрут отгрузки» — вертикальный ProcessRail. */
export function RailPanel({ status, ops }: { status: DispatchStatus; ops?: DispatchOp[] }) {
  return (
    <Panel icon="truckRoute" title="Маршрут отгрузки" bodyPad={false}>
      <div style={{ padding: '12px 14px' }}>
        <ProcessRail steps={buildDispatchSteps(status, ops)} />
      </div>
    </Panel>
  )
}
