import type { ShipmentCargoType, ShipmentDetail, ShipmentStatus } from '../../../../../api/shipmentsApi'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { InfoPhase } from '../components/InfoPhase'
import type { InfoPhaseProps } from '../components/InfoPhase'
import { CompositionPhase } from '../components/CompositionPhase'
import type { CompositionPhaseProps } from '../components/CompositionPhase'
import { PackingPhase } from '../components/PackingPhase'
import type { PackingPhaseData } from '../components/PackingPhase'
import { Panel, ReadRow, RailPanel, ChecklistPanel, LockedGrid } from '../components/processUI'
import type { ChecklistItem } from '../components/processUI'

type Props = {
  doc: ShipmentDetail
  isPacking: boolean
  isDefectCargo: boolean
  info: InfoPhaseProps
  composition: CompositionPhaseProps
  packing: PackingPhaseData
  checklist: ChecklistItem[]
}

/** packing / on_packing — передача на упаковку кладовщиком и упаковка начальником смены. */
export function PackingView({ doc, isPacking, isDefectCargo, info, composition, packing, checklist }: Props) {
  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const poolTotal = doc.lines.reduce((s, l) => s + l.available_for_pack, 0)
  const packedGood = doc.lines.reduce((s, l) => s + l.packed_good, 0)
  const packedDefect = doc.lines.reduce((s, l) => s + l.packed_defect, 0)
  const storeAgg = (() => {
    const m = new Map<string, number>()
    for (const l of doc.lines) {
      const k = l.store_name ?? 'Без магазина'
      m.set(k, (m.get(k) ?? 0) + l.qty)
    }
    return [...m.entries()]
  })()

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      {/* Left — фазы */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoPhase {...info} />

        <CompositionPhase {...composition} />

        {!isDefectCargo && (
          <PackingPhase
            {...packing}
            phase={isPacking
              ? { state: 'active', role: 'warehouse', title: 'Передача на упаковку', mode: 'transfer',
                  hint: '«Передать» — выбор мест-источников, перемещение сразу' }
              : { state: 'active', role: 'shift_lead', title: 'Упаковка', mode: 'packing',
                  hint: '«Внести упаковку» — годный и брак; при браке кладовщик подвозит товар' }}
          />
        )}

        {!isDefectCargo && (
          <PhaseBlock icon="archive" title="Раскладка" role="warehouse" state="locked"
            hint="Местоположения и упаковка — после передачи на упаковку">
            <LockedGrid labels={['Местоположения', 'Упаковано']} />
          </PhaseBlock>
        )}
      </div>

      {/* Right — маршрут + контекстные панели */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status={doc.status as ShipmentStatus} ops={doc.ops} cargoType={doc.cargo_type as ShipmentCargoType} />

        {isPacking && (
          <ChecklistPanel items={checklist} />
        )}

        {isPacking && storeAgg.length > 0 && (
          <Panel icon="building" title="Магазины">
            <div style={{ padding: '0 2px' }}>
              {storeAgg.map(([name, qty]) => (
                <ReadRow key={name} label={name} mono>{qty} шт</ReadRow>
              ))}
            </div>
          </Panel>
        )}

        {!isPacking && (
          <Panel icon="box" title="Итог упаковки">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="План" mono>{planTotal} шт</ReadRow>
              <ReadRow label="На упаковке" mono>{poolTotal} шт</ReadRow>
              <ReadRow label="Годный" mono><span style={{ color: 'var(--c-success)' }}>{packedGood}</span></ReadRow>
              <ReadRow label="Брак" mono><span style={{ color: 'var(--c-danger)' }}>{packedDefect}</span></ReadRow>
              <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                <ReadRow label="Осталось до плана" mono strong>{Math.max(0, planTotal - packedGood)} шт</ReadRow>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
