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
  info:        InfoPhaseProps
  composition: CompositionPhaseProps
  packing:     PackingPhaseData
  canManage:   boolean
  checklist:   ChecklistItem[]
  onDone:      () => Promise<void> | void
}

/** Задача «Упаковка с ТСД»: передача на упаковку → сборка коробов. Конец.
 *
 * Собранное упаковано и доступно отгрузке сразу; развозку коробов в зону отгрузки
 * ведёт отдельный процесс (очередь коробов, скан на ТСД), поэтому карточка
 * заканчивается на «Сборка завершена» — этим задача и закрывается.
 */
export function PutawayView({
  docId, doc, isPacking, isCollected, info, composition, packing,
  canManage, checklist, onDone,
}: Props) {
  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const poolTotal = doc.lines.reduce((s, l) => s + l.available_for_pack, 0)
  const goodTotal = doc.lines.reduce((s, l) => s + l.packed_good, 0)
  const defectTotal = doc.lines.reduce((s, l) => s + l.packed_defect, 0)
  // «Собрано» = всё, что снято сканом из зоны упаковки, годное и брак. Считаем по факту
  // упаковки, а не по остатку у стола: после развозки он пустеет, а собрано —
  // остаётся собранным.
  const collectedTotal = goodTotal + defectTotal
  const collectedPct = planTotal > 0 ? Math.min(100, Math.round((collectedTotal / planTotal) * 100)) : 0
  const boxedTotal = doc.lines.reduce((s, l) => s + l.boxed_qty, 0)
  const asideTotal = doc.lines.reduce((s, l) => s + l.aside_qty, 0)
  const placedTotal = doc.lines.reduce((s, l) => s + l.placed_qty, 0)
  const boxes = doc.boxes ?? []
  const boxesPlaced = boxes.filter((b) => b.status === 'placed').length
  const boxesWaiting = boxes.filter((b) => b.status === 'closed').length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      {/* Left — фазы */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoPhase {...info} putaway />

        <CompositionPhase {...composition} putaway />

        {/* Упаковка вносится не здесь: в этой задаче каждая единица пикается на ТСД
            прямо в короб — скан и есть запись упаковки. Здесь только подвоз в зону. */}
        <PackingPhase
          {...packing}
          putaway
          phase={isPacking
            ? { state: 'active', role: 'warehouse', title: 'Передача на упаковку', mode: 'transfer',
                hint: '«Передать» — выбор мест-источников, перемещение сразу' }
            : { state: 'done', role: 'warehouse', title: 'Передача на упаковку', mode: 'transfer',
                hint: 'товар в зоне упаковки — снимается сканом в короба на ТСД' }}
        />

        {isPacking ? (
          <PhaseBlock icon="box" title="Короба" role="shift_lead" state="locked"
            hint="Сборка коробов — после передачи товара на упаковку">
            <LockedGrid labels={['Собрано в короба', 'Брак']} />
          </PhaseBlock>
        ) : (
          <BoxesPanel
            docId={docId}
            doc={doc}
            canEdit={canManage}
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
          <Panel icon="box" title="Итог сборки">
            <div style={{ padding: '0 2px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
                <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{collectedTotal}</span>
                <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>из {planTotal} шт</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: collectedPct >= 100 ? 'var(--c-success)' : 'var(--c-text-muted)' }}>
                  {collectedPct}%
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'var(--c-bg-sunken)', overflow: 'hidden', marginBottom: 10 }}>
                <div style={{
                  width: `${collectedPct}%`, height: '100%', borderRadius: 99,
                  background: collectedPct >= 100 ? 'var(--c-success)' : 'var(--c-accent)',
                }} />
              </div>
              <ReadRow label="Годный" mono>{goodTotal} шт</ReadRow>
              <ReadRow label="Брак" mono>
                <span style={{ color: defectTotal > 0 ? 'var(--c-danger)' : undefined }}>{defectTotal} шт</span>
              </ReadRow>
              {asideTotal > 0 && <ReadRow label="Из них без короба" mono>{asideTotal} шт</ReadRow>}
              <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                <ReadRow label="Осталось на упаковке" mono strong>
                  <span style={{ color: poolTotal > 0 ? 'var(--c-warning)' : 'var(--c-text-subtle)' }}>{poolTotal} шт</span>
                </ReadRow>
              </div>
            </div>
          </Panel>
        )}

        {/* Развозка — чужой процесс (очередь коробов), поэтому отдельной панелью:
            её нули не должны читаться как незакрытый хвост этой задачи. */}
        {!isPacking && (boxedTotal > 0 || placedTotal > 0) && (
          <Panel icon="archive" title="Дальше: развозка">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="Ждут развозки" mono>{boxedTotal} шт</ReadRow>
              <ReadRow label="— в коробах" mono>{boxesWaiting} короб.</ReadRow>
              {asideTotal > 0 && <ReadRow label="— без короба" mono>{asideTotal} шт</ReadRow>}
              <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                <ReadRow label="Уже на местах" mono>{placedTotal} шт{boxesPlaced > 0 ? ` · ${boxesPlaced} короб.` : ''}</ReadRow>
              </div>
              <div className="t-sub" style={{ fontSize: 12, marginTop: 8 }}>
                Развозку ведёт общая очередь коробов — статус этой задачи она не двигает.
              </div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
