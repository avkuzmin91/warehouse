import type { ShipmentCargoType, ShipmentDetail, ShipmentStatus } from '../../../../../api/shipmentsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { InfoPhase } from '../components/InfoPhase'
import type { InfoPhaseProps } from '../components/InfoPhase'
import { CompositionPhase } from '../components/CompositionPhase'
import type { CompositionPhaseProps } from '../components/CompositionPhase'
import { PackingPhase } from '../components/PackingPhase'
import type { PackingPhaseData } from '../components/PackingPhase'
import { RelocationPanel } from '../components/RelocationPanel'
import { DefectPreparePanel } from '../components/DefectPreparePanel'
import { Panel, ReadRow, RailPanel } from '../components/processUI'

type Props = {
  docId: string
  doc: ShipmentDetail
  isDefectCargo: boolean
  info: InfoPhaseProps
  composition: CompositionPhaseProps
  packing: PackingPhaseData
  canRelocate: boolean
  zoneOptions: DictionaryItem[]
  onLinesChanged: () => Promise<void>
}

/** relocating — раскладка упакованного по местам (годный груз) или подготовка брака. */
export function RelocatingView({
  docId, doc, isDefectCargo, info, composition, packing, canRelocate, zoneOptions, onLinesChanged,
}: Props) {
  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const skuCount = new Set(doc.lines.map((l) => l.product_sku)).size
  const packedGood = doc.lines.reduce((s, l) => s + l.packed_good, 0)
  const packedDefect = doc.lines.reduce((s, l) => s + l.packed_defect, 0)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      {/* Left — фазы */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoPhase {...info} />

        <CompositionPhase {...composition} />

        {!isDefectCargo && (
          <PackingPhase
            {...packing}
            phase={{ state: 'done', role: 'shift_lead', title: 'Упаковка', mode: 'result', hint: undefined }}
          />
        )}

        {!isDefectCargo && (
          <RelocationPanel
            docId={docId}
            lines={doc.lines}
            zoneOptions={zoneOptions}
            canEdit={canRelocate}
            onDone={onLinesChanged}
          />
        )}

        {isDefectCargo && (
          <DefectPreparePanel
            docId={docId}
            lines={doc.lines}
            clientId={doc.client_id}
            canEdit={canRelocate}
            onDone={onLinesChanged}
          />
        )}
      </div>

      {/* Right — маршрут + контекстные панели */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status={doc.status as ShipmentStatus} ops={doc.ops} cargoType={doc.cargo_type as ShipmentCargoType} />

        {isDefectCargo && (
          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{skuCount}</ReadRow>
              <ReadRow label="Кол-во" mono strong>{planTotal} шт</ReadRow>
            </div>
          </Panel>
        )}

        {!isDefectCargo && (
          <Panel icon="chart" title="Итог раскладки">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="Годный" mono><span style={{ color: 'var(--c-success)' }}>{packedGood} шт</span></ReadRow>
              <ReadRow label="Брак" mono><span style={{ color: 'var(--c-danger)' }}>{packedDefect} шт</span></ReadRow>
              <ReadRow label="Упаковано" mono>{packedGood + packedDefect} шт</ReadRow>
            </div>
          </Panel>
        )}
      </div>
    </div>
  )
}
