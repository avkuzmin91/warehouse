import type { ShipmentCargoType, ShipmentDetail, ShipmentStatus } from '../../../../../api/shipmentsApi'

import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { InfoPhase } from '../components/InfoPhase'
import type { InfoPhaseProps } from '../components/InfoPhase'
import { CompositionPhase } from '../components/CompositionPhase'
import type { CompositionPhaseProps } from '../components/CompositionPhase'
import { PackingPhase } from '../components/PackingPhase'
import type { PackingPhaseData } from '../components/PackingPhase'
import { BoxesPanel } from '../components/BoxesPanel'
import { Panel, ReadRow, RailPanel, ChecklistPanel, LockedGrid } from '../components/processUI'
import type { ChecklistItem } from '../components/processUI'

type Props = {
  docId:       string
  doc:         ShipmentDetail
  isPacking:   boolean
  isCollected: boolean
  isPlaced:    boolean
  info:        InfoPhaseProps
  composition: CompositionPhaseProps
  packing:     PackingPhaseData
  canManage:   boolean
  checklist:   ChecklistItem[]
  onDone:      () => Promise<void> | void
}

/** Задача «Размещение по ячейкам»: передача на стол → сборка коробов → развозка.
 *
 * Развозку по местам ведёт отдельный процесс на ТСД (скан коробов → скан места),
 * поэтому карточка заканчивается на «Сборка завершена»: дальше задача закрывается сама.
 */
export function PutawayView({
  docId, doc, isPacking, isCollected, isPlaced, info, composition, packing,
  canManage, checklist, onDone,
}: Props) {
  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const poolTotal = doc.lines.reduce((s, l) => s + l.available_for_pack, 0)
  const packedTotal = doc.lines.reduce((s, l) => s + l.packed_good, 0)
  const boxedTotal = doc.lines.reduce((s, l) => s + l.boxed_qty, 0)
  const asideTotal = doc.lines.reduce((s, l) => s + l.aside_qty, 0)
  const placedTotal = doc.lines.reduce((s, l) => s + l.placed_qty, 0)
  const defectTotal = doc.lines.reduce((s, l) => s + l.packed_defect, 0)
  const boxes = doc.boxes ?? []
  const boxesPlaced = boxes.filter((b) => b.status === 'placed').length
  const boxesWaiting = boxes.filter((b) => b.status === 'closed').length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      {/* Left — фазы */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoPhase {...info} />

        <CompositionPhase {...composition} />

        {/* Упаковка вносится не здесь: в этой задаче каждая единица пикается на ТСД
            прямо в короб — скан и есть запись упаковки. Здесь только подвоз на стол. */}
        <PackingPhase
          {...packing}
          phase={isPacking
            ? { state: 'active', role: 'warehouse', title: 'Передача на стол', mode: 'transfer',
                hint: '«Передать» — выбор мест-источников, перемещение сразу' }
            : { state: 'done', role: 'warehouse', title: 'Передача на стол', mode: 'transfer',
                hint: 'товар на столе — упаковывается сканом в короба на ТСД' }}
        />

        {isPacking ? (
          <PhaseBlock icon="box" title="Короба" role="shift_lead" state="locked"
            hint="Сборка коробов — после передачи товара на стол">
            <LockedGrid labels={['Собрано в короба', 'Развезено по местам']} />
          </PhaseBlock>
        ) : (
          <BoxesPanel
            docId={docId}
            doc={doc}
            canEdit={canManage}
            readOnly={isPlaced}
            collected={isCollected}
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
              <ReadRow label="Осталось на столе" mono>{poolTotal} шт</ReadRow>
              <ReadRow label="Упаковано сканом" mono>{packedTotal} шт</ReadRow>
              <ReadRow label="Ждёт размещения" mono>{boxedTotal} шт</ReadRow>
              {asideTotal > 0 && <ReadRow label="Из них мимо коробов" mono>{asideTotal} шт</ReadRow>}
              <ReadRow label="Брак" mono><span style={{ color: 'var(--c-danger)' }}>{defectTotal}</span></ReadRow>
              <ReadRow label="Коробов на местах" mono>{boxesPlaced}</ReadRow>
              {boxesWaiting > 0 && <ReadRow label="Коробов ждут развозки" mono>{boxesWaiting}</ReadRow>}
              <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                <ReadRow label="Размещено по местам" mono strong>{placedTotal} шт</ReadRow>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
