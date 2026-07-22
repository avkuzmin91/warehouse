import type { ShipmentLine, ShipmentRepackKind } from '../../../../../api/shipmentsApi'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import type { PhaseState } from '../../../shared/process/PhaseBlock'
import type { ProcessRole } from '../../../shared/process/roles'
import { Icon } from '../../../../primitives/Icon'
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
  // Активная переупаковка: баннер с причиной над таблицей (пока пакуют заново).
  repackActive?: boolean
  repackKind?: ShipmentRepackKind | null
  repackReason?: string | null
  onOpenMove: (line: ShipmentLine) => void
  onReturn: (line: ShipmentLine) => void
  onOpenPacking: (line: ShipmentLine) => void
  onOpenPlace: (line: ShipmentLine) => void
}

export function PackingPhase({
  phase, lines, canMove, canPack, canReturn, canPlace, acting, savingLine,
  repackActive, repackKind, repackReason,
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
      {repackActive && repackKind && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-start',
          padding: '8px 10px', marginBottom: 10, borderRadius: 'var(--r-md)',
          border: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)',
          fontSize: 12.5,
        }}>
          <Icon name="refresh" size={14} />
          <span>
            <b>{repackKind === 'free' ? 'Переупаковка без оплаты' : 'Переупаковка за счёт клиента'}</b>
            {' — '}
            {repackKind === 'free'
              ? 'повторные операции упаковки клиенту не выставляются.'
              : 'повторная упаковка будет выставлена клиенту строкой «Доп. работы».'}
            {repackReason && <span className="t-sub" style={{ display: 'block', color: 'var(--c-text-subtle)' }}>Причина: {repackReason}</span>}
          </span>
        </div>
      )}
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
