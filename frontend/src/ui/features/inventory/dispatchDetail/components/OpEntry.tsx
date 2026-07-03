import type { DispatchOp } from '../../../../../api/dispatchApi'
import { OpEntry as InventoryOpEntry } from '../../shared/OpEntry'
import { OP_ICONS, OP_LABELS, OP_TONES } from '../shared/opLabels'

export function OpEntry({ op }: { op: DispatchOp }) {
  return <InventoryOpEntry op={op} labels={OP_LABELS} icons={OP_ICONS} tones={OP_TONES} />
}
