import type { ShipmentLine } from '../../../../../api/shipmentsApi'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import type { PhaseState } from '../../../shared/process/PhaseBlock'
import type { ProcessRole } from '../../../shared/process/roles'
import { LockedGrid } from './processUI'
import { PackingTable } from './PackingTable'
import type { EditableShipmentLine } from '../shared/types'

// Фаза «Упаковка»: передача (Кладовщик, packing) → годный/брак (Нач. смены, on_packing) → результат (done).
export type PackPhase = {
  state: PhaseState
  role: ProcessRole
  title: string
  mode: 'transfer' | 'packing' | 'result' | null
  hint?: string
}

export type PackingPhaseData = {
  lines: EditableShipmentLine[]
  canMove: boolean
  canPack: boolean
  canReturn: boolean
  canPlace: boolean
  acting: boolean
  savingLine: string | null
  onOpenMove: (line: ShipmentLine) => void
  onReturn: (line: ShipmentLine) => void
  onOpenPacking: (line: ShipmentLine) => void
  onOpenPlace: (line: ShipmentLine) => void
}

export function PackingPhase({
  phase, lines, canMove, canPack, canReturn, canPlace, acting, savingLine,
  onOpenMove, onReturn, onOpenPacking, onOpenPlace,
}: PackingPhaseData & { phase: PackPhase }) {
  return (
    <PhaseBlock
      icon="box"
      title={phase.title}
      role={phase.role}
      state={phase.state}
      hint={phase.hint}
    >
      {phase.mode === null ? (
        <LockedGrid labels={['На упаковке', 'Годный', 'Брак']} />
      ) : lines.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          Нет позиций для упаковки.
        </div>
      ) : (
        <PackingTable
          mode={phase.mode}
          lines={lines}
          canMove={canMove}
          canPack={canPack}
          canReturn={canReturn}
          canPlace={canPlace}
          acting={acting}
          savingLine={savingLine}
          onOpenMove={onOpenMove}
          onReturn={onReturn}
          onOpenPacking={onOpenPacking}
          onOpenPlace={onOpenPlace}
        />
      )}
    </PhaseBlock>
  )
}
