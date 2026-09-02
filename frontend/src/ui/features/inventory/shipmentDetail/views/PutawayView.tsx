import type { ShipmentCargoType, ShipmentDetail, ShipmentStatus } from '../../../../../api/shipmentsApi'

import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { InfoPhase } from '../components/InfoPhase'
import type { InfoPhaseProps } from '../components/InfoPhase'
import { CompositionPhase } from '../components/CompositionPhase'
import type { CompositionPhaseProps } from '../components/CompositionPhase'
import { PackingPhase } from '../components/PackingPhase'
import type { PackingPhaseData } from '../components/PackingPhase'
import { BoxesPanel } from '../components/BoxesPanel'
import type { CellOption } from '../components/BoxesPanel'
import { Panel, ReadRow, RailPanel, ChecklistPanel, LockedGrid } from '../components/processUI'
import type { ChecklistItem } from '../components/processUI'

type Props = {
  docId:       string
  doc:         ShipmentDetail
  isPacking:   boolean
  isPlaced:    boolean
  info:        InfoPhaseProps
  composition: CompositionPhaseProps
  packing:     PackingPhaseData
  cellOptions: CellOption[]
  canManage:   boolean
  checklist:   ChecklistItem[]
  onDone:      () => Promise<void> | void
}

/** Задача «Размещение по ячейкам»: передача на стол → короба → ячейки. */
export function PutawayView({
  docId, doc, isPacking, isPlaced, info, composition, packing, cellOptions, canManage, checklist, onDone,
}: Props) {
  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const poolTotal = doc.lines.reduce((s, l) => s + l.available_for_pack, 0)
  const boxedTotal = doc.lines.reduce((s, l) => s + l.boxed_qty, 0)
  const placedTotal = doc.lines.reduce((s, l) => s + l.placed_qty, 0)
  const defectTotal = doc.lines.reduce((s, l) => s + l.packed_defect, 0)
  const toBoxTotal = doc.lines.reduce((s, l) => s + l.packed_pending_good, 0)
  const boxesPlaced = (doc.boxes ?? []).filter((b) => b.status === 'placed').length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      {/* Left — фазы */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoPhase {...info} />

        <CompositionPhase {...composition} />

        {/* Упаковку вносит начальник смены — так же, как в задаче под отгрузку;
            в короб потом кладут уже упакованное. */}
        <PackingPhase
          {...packing}
          phase={isPacking
            ? { state: 'active', role: 'warehouse', title: 'Передача на стол', mode: 'transfer',
                hint: '«Передать» — выбор мест-источников, перемещение сразу' }
            : isPlaced
              ? { state: 'done', role: 'shift_lead', title: 'Упаковка', mode: 'packing',
                  hint: 'товар упакован и разложен по коробам' }
              : { state: 'active', role: 'shift_lead', title: 'Упаковка', mode: 'packing',
                  hint: '«Внести упаковку» — годный и брак; упакованное дальше сканируется в короба' }}
        />

        {isPacking ? (
          <PhaseBlock icon="box" title="Короба" role="warehouse" state="locked"
            hint="Сборка коробов — после передачи товара на стол">
            <LockedGrid labels={['Собрано в короба', 'Разложено по ячейкам']} />
          </PhaseBlock>
        ) : (
          <BoxesPanel
            docId={docId}
            doc={doc}
            cellOptions={cellOptions}
            canEdit={canManage}
            readOnly={isPlaced}
            onDone={onDone}
          />
        )}
      </div>

      {/* Right — маршрут + итоги */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel
          status={doc.status as ShipmentStatus}
          ops={doc.ops}
          cargoType={doc.cargo_type as ShipmentCargoType}
          taskKind="putaway"
        />

        {isPacking && <ChecklistPanel items={checklist} />}

        {!isPacking && (
          <Panel icon="archive" title="Итог размещения">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="План" mono>{planTotal} шт</ReadRow>
              <ReadRow label="На столе (не упаковано)" mono>{poolTotal} шт</ReadRow>
              <ReadRow label="Упаковано, ждёт короб" mono>{toBoxTotal} шт</ReadRow>
              <ReadRow label="В коробах" mono>{boxedTotal} шт</ReadRow>
              <ReadRow label="Брак" mono><span style={{ color: 'var(--c-danger)' }}>{defectTotal}</span></ReadRow>
              <ReadRow label="Коробов в ячейках" mono>{boxesPlaced}</ReadRow>
              <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                <ReadRow label="Разложено по ячейкам" mono strong>{placedTotal} шт</ReadRow>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
