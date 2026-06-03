import { Icon } from '../../../../primitives/Icon'
import type { TripDetail } from '../../../../../api/tripsApi'
import { TripHeader, PrimaryAction } from '../TripHeader'
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

export function PlanningView({ detail, form, onField, link, enrich, busy, checks, onBack, onCancel, onHandoff, onOpenReceipt }: {
  detail: TripDetail
  form: PlanningFormValue
  onField: (patch: Partial<PlanningFormValue>) => void
  link: ReceiptLink
  enrich?: ReceiptEnrich
  busy: boolean
  checks: Check[]
  onBack: () => void
  onCancel: () => void
  onHandoff: () => void
  onOpenReceipt: (id: string) => void
}) {
  const { doc, ops, receipts } = detail
  return (
    <div className="page">
      <TripHeader
        number={doc.trip_number}
        status="draft"
        onBack={onBack}
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <button className="btn ghost danger" onClick={onCancel} disabled={busy}>
              <Icon name="x" size={14} />Аннулировать
            </button>
            <PrimaryAction
              icon="arrowRight"
              label="Передать на склад"
              hint="Рейс уйдёт кладовщику в очередь «Мои задачи»"
              onClick={onHandoff}
              disabled={busy}
            />
          </div>
        }
      />

      <div className="split-360">
        <div className="col gap-16">
          <PlanningForm value={form} onChange={onField} state="active" />

          <ReceiptsBlock
            receipts={receipts}
            enrich={enrich}
            onOpen={onOpenReceipt}
            link={link}
          />

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="warehouse" state="locked"
            hint="Заполнит кладовщик, когда машина приедет">
            <LockedGrid labels={['Прибытие', 'Окончание разгрузки', 'Загруженность']} />
          </PhaseBlock>

          <PhaseBlock icon="ruble" title="Закрытие и стоимость" role="manager" state="locked" hint="После разгрузки">
            <LockedGrid labels={['Логистика (факт)', 'Стоимость простоя']} />
          </PhaseBlock>
        </div>

        <div className="col gap-16">
          <ProcessPanel status="draft" ops={ops} />
          <ReadyChecklist checks={checks} />
        </div>
      </div>
    </div>
  )
}
