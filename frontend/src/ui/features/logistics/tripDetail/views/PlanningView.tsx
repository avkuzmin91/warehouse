import type { ReactNode } from 'react'
import { Icon } from '../../../../primitives/Icon'
import type { TripDetail, TripDirection } from '../../../../../api/tripsApi'
import { tripLexicon } from '../../../../../api/tripsApi'
import { TripHeader } from '../TripHeader'
import { PrimaryAction } from '../../../shared/process/PrimaryAction'
import { PlanningForm } from '../PlanningForm'
import type { PlanningFormValue } from '../PlanningForm'
import { PhaseBlock } from '../../components/PhaseBlock'
import { FieldLabel } from '../../components/fields'
import { ReceiptsBlock } from '../ReceiptsBlock'
import type { ReceiptLink, ReceiptEnrich } from '../ReceiptsBlock'
import { ProcessPanel, ReadyChecklist } from '../panels'
import type { Check } from '../panels'

function LockedGrid({ labels }: { labels: string[] }) {
  return (
    <div className="form-grid-2">
      {labels.map((l) => (
        <div key={l}>
          <FieldLabel>{l}</FieldLabel>
          <div style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>после</div>
        </div>
      ))}
    </div>
  )
}

export function PlanningView({ detail, form, onField, link, enrich, busy, checks, showCosts, canEditTransportPlanning, invalid, blockReasons, dirtyFields, onBack, onCancel, onSaveFields, onHandoff, onOpenReceipt, docsNode }: {
  detail: TripDetail
  form: PlanningFormValue
  onField: (patch: Partial<PlanningFormValue>) => void
  link: ReceiptLink
  enrich?: ReceiptEnrich
  busy: boolean
  checks: Check[]
  showCosts: boolean
  canEditTransportPlanning: boolean
  invalid?: Partial<Record<keyof PlanningFormValue, boolean>>
  blockReasons: string[]
  dirtyFields: boolean
  onBack: () => void
  onCancel: () => void
  onSaveFields: () => void
  onHandoff: () => void
  onOpenReceipt: (id: string) => void
  /** Для outbound-рейса — блок отгрузок вместо ReceiptsBlock. */
  docsNode?: ReactNode
}) {
  const { doc, ops, receipts } = detail
  const direction = (doc.direction as TripDirection) ?? 'inbound'
  const lex = tripLexicon(direction)
  return (
    <div className="page">
      <TripHeader
        number={doc.trip_number}
        status="draft"
        direction={direction}
        cargoType={doc.cargo_type}
        onBack={onBack}
        action={
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <button className="btn ghost danger" onClick={onCancel} disabled={busy}>
                <Icon name="x" size={14} />Аннулировать
              </button>
              {canEditTransportPlanning && dirtyFields && (
                <button className="btn" onClick={onSaveFields} disabled={busy}>
                  <Icon name="save" size={14} />Сохранить изменения
                </button>
              )}
              {showCosts && (
                <PrimaryAction
                  icon="arrowRight"
                  label="Передать на склад"
                  onClick={onHandoff}
                  disabled={busy}
                />
              )}
            </div>
            {blockReasons.length > 0 && (
              <div className="block-reasons">
                {blockReasons.map((r, i) => (
                  <div key={i}>· {r}</div>
                ))}
              </div>
            )}
          </div>
        }
      />

      <div className="split-360">
        <div className="col gap-16">
          <PlanningForm value={form} onChange={onField} state="active" invalid={invalid} showCosts={showCosts} readonly={!canEditTransportPlanning} routeLabel={lex.routeLabel} etaLabel={lex.etaLabel} />

          {docsNode ?? (
            <ReceiptsBlock
              receipts={receipts}
              enrich={enrich}
              onOpen={onOpenReceipt}
              link={link}
              expandable
              resetKey={doc.id}
            />
          )}

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="warehouse" state="locked"
            hint="Заполнит кладовщик, когда машина приедет">
            <LockedGrid labels={[lex.arrivalLabel, lex.unloadEndLabel, 'Загруженность']} />
          </PhaseBlock>

          {showCosts && (
            <PhaseBlock icon="ruble" title="Закрытие и стоимость" role="manager" state="locked" hint="После разгрузки">
              <LockedGrid labels={['Логистика (факт)', 'Стоимость простоя']} />
            </PhaseBlock>
          )}
        </div>

        <div className="col gap-16">
          <ProcessPanel status="draft" ops={ops} direction={direction} />
          <ReadyChecklist checks={checks} />
        </div>
      </div>
    </div>
  )
}
