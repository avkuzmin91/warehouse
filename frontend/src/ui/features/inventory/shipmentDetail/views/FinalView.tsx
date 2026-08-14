import type { ShipmentCargoType, ShipmentDetail, ShipmentStatus } from '../../../../../api/shipmentsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { Alert } from '../../../../primitives/Alert'
import { InfoPhase } from '../components/InfoPhase'
import type { InfoPhaseProps } from '../components/InfoPhase'
import { CompositionPhase } from '../components/CompositionPhase'
import type { CompositionPhaseProps } from '../components/CompositionPhase'
import { PackingPhase } from '../components/PackingPhase'
import type { PackingPhaseData } from '../components/PackingPhase'
import { RelocationPanel } from '../components/RelocationPanel'
import { Panel, ReadRow, RailPanel } from '../components/processUI'

type Props = {
  docId: string
  doc: ShipmentDetail
  isPacked: boolean
  isCompletedNoGoods: boolean
  isDefectCargo: boolean
  info: InfoPhaseProps
  composition: CompositionPhaseProps
  packing: PackingPhaseData
  zoneOptions: DictionaryItem[]
  onLinesChanged: () => Promise<void>
}

/** packed / completed_no_goods / cancelled — read-only. */
export function FinalView({
  docId, doc, isPacked, isCompletedNoGoods, isDefectCargo, info, composition, packing, zoneOptions, onLinesChanged,
}: Props) {
  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const packedGood = doc.lines.reduce((s, l) => s + l.packed_good, 0)
  const packedDefect = doc.lines.reduce((s, l) => s + l.packed_defect, 0)

  return (
    <>
      {isPacked && (
        <Alert tone="success" style={{ marginBottom: 16 }}>
          {isDefectCargo
            ? 'Брак подготовлен и перемещён в зону отгрузки со статусом «Готов к отгрузке». Задача упаковки завершена.'
            : 'Товар упакован и разложен по местоположениям со статусом «Готов к отгрузке». Задача упаковки завершена.'}
        </Alert>
      )}

      {isCompletedNoGoods && (
        <Alert tone="warning" style={{ marginBottom: 16 }}>
          Задача завершена без отгрузки: весь товар оказался браком. Доступен только просмотр.
        </Alert>
      )}

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

          {(isPacked || isCompletedNoGoods) && (
            <RelocationPanel
              docId={docId}
              lines={doc.lines}
              zoneOptions={zoneOptions}
              canEdit={false}
              readOnly
              onDone={onLinesChanged}
            />
          )}
        </div>

        {/* Right — маршрут + контекстные панели */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RailPanel status={doc.status as ShipmentStatus} ops={doc.ops} cargoType={doc.cargo_type as ShipmentCargoType} />

          {isPacked && (
            <Panel icon="chart" title={isDefectCargo ? 'Итог подготовки' : 'Итог упаковки'}>
              <div style={{ padding: '0 2px' }}>
                <ReadRow label="План" mono>{planTotal} шт</ReadRow>
                <ReadRow label={isDefectCargo ? 'Брак' : 'Годный'} mono>
                  <span style={{ color: isDefectCargo ? 'var(--c-warning)' : 'var(--c-success)' }}>{isDefectCargo ? packedDefect : packedGood} шт</span>
                </ReadRow>
                {!isDefectCargo && (
                  <ReadRow label="Брак (на складе)" mono><span style={{ color: 'var(--c-danger)' }}>{packedDefect} шт</span></ReadRow>
                )}
                <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                  <ReadRow label="Итог" mono strong>Готово к отгрузке</ReadRow>
                </div>
              </div>
            </Panel>
          )}

          {isCompletedNoGoods && (
            <Panel icon="chart" title="Итог">
              <div style={{ padding: '0 2px' }}>
                <ReadRow label="План" mono>{planTotal} шт</ReadRow>
                <ReadRow label="Отгружено" mono>
                  <span style={{ color: 'var(--c-success)' }}>{doc.lines.reduce((s, l) => s + l.shipped_qty, 0)} шт</span>
                </ReadRow>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </>
  )
}
