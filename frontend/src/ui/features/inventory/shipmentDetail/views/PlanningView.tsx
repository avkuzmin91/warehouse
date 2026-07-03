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
  isDraft: boolean
  isDefectCargo: boolean
  info: InfoPhaseProps
  composition: CompositionPhaseProps
  packing: PackingPhaseData
  checklist: ChecklistItem[]
}

/** draft / assigned — сборка плана менеджером и приёмка задачи начальником склада. */
export function PlanningView({ doc, isDraft, isDefectCargo, info, composition, packing, checklist }: Props) {
  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const skuCount = new Set(doc.lines.map((l) => l.product_sku)).size

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
      {/* Left — фазы */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <InfoPhase {...info} />

        <CompositionPhase {...composition} />

        {!isDefectCargo && (
          <PackingPhase
            {...packing}
            phase={{ state: 'locked', role: 'shift_lead', title: 'Упаковка', mode: null,
              hint: 'Передачу и упаковку заполнят кладовщик и начальник смены' }}
          />
        )}

        {!isDefectCargo && (
          <PhaseBlock icon="archive" title="Раскладка" role="warehouse" state="locked"
            hint="Местоположения и упаковка — после передачи на упаковку">
            <LockedGrid labels={['Местоположения', 'Упаковано']} />
          </PhaseBlock>
        )}

        {isDefectCargo && isDraft && (
          <PhaseBlock icon="archive" title="Подготовка к отгрузке" role="warehouse" state="locked"
            hint="Кладовщик выберет места-источники и перенесёт брак в зону отгрузки">
            <LockedGrid labels={['Места-источники', 'Упаковано']} />
          </PhaseBlock>
        )}
      </div>

      {/* Right — маршрут + контекстные панели */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <RailPanel status={doc.status as ShipmentStatus} ops={doc.ops} cargoType={doc.cargo_type as ShipmentCargoType} />

        <ChecklistPanel items={checklist} />

        <Panel icon="chart" title="Итого">
          <div style={{ padding: '0 2px' }}>
            <ReadRow label="SKU" mono>{skuCount}</ReadRow>
            <ReadRow label="Кол-во" mono strong>{planTotal} шт</ReadRow>
          </div>
        </Panel>
      </div>
    </div>
  )
}
