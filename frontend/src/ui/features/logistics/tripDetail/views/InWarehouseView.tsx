import { Icon } from '../../../../primitives/Icon'
import { TRIP_LOAD_LABELS } from '../../../../../api/tripsApi'
import type { TripDetail, TripLoadFactor } from '../../../../../api/tripsApi'
import { TripHeader } from '../TripHeader'
import { PlanningForm } from '../PlanningForm'
import type { PlanningFormValue } from '../PlanningForm'
import { PhaseBlock } from '../../components/PhaseBlock'
import { DateTimeField, FieldLabel, Segmented, timePart } from '../../components/fields'
import { ReceiptsBlock } from '../ReceiptsBlock'
import type { ReceiptLink, ReceiptEnrich } from '../ReceiptsBlock'
import { ProcessPanel, CostPanel, JournalPanel } from '../panels'

function LockedCostFields() {
  return (
    <div className="form-grid-2">
      {['Логистика (факт)', 'Стоимость простоя'].map((label) => (
        <div key={label}>
          <FieldLabel>{label}</FieldLabel>
          <div style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>после разгрузки</div>
        </div>
      ))}
    </div>
  )
}

function isBefore(left: string, right: string): boolean {
  const leftTs = new Date(left).getTime()
  const rightTs = new Date(right).getTime()
  return Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs < rightTs
}

export function InWarehouseView({ detail, form, onField, showCosts, canEditTransportPlanning, link, enrich, loadFactor, onLoadFactor, arrival, onArrivalChange, unloadStart, onUnloadStartChange, unloadEnd, onUnloadEndChange, busy, onBack, onCancel, onSaveFields, onArrival, onUnload, onOpenReceipt }: {
  detail: TripDetail
  form: PlanningFormValue
  onField: (patch: Partial<PlanningFormValue>) => void
  showCosts: boolean
  canEditTransportPlanning: boolean
  link?: ReceiptLink
  enrich?: ReceiptEnrich
  loadFactor: TripLoadFactor
  onLoadFactor: (v: TripLoadFactor) => void
  arrival: string
  onArrivalChange: (v: string) => void
  unloadStart: string
  onUnloadStartChange: (v: string) => void
  unloadEnd: string
  onUnloadEndChange: (v: string) => void
  busy: boolean
  onBack: () => void
  onCancel: () => void
  onSaveFields: () => void
  onArrival: () => void
  onUnload: () => void
  onOpenReceipt: (id: string) => void
}) {
  const { doc, ops, receipts } = detail
  const unloading = doc.status === 'unloading'
  const arrivalReady = timePart(arrival).length === 5
  const unloadStartReady = timePart(unloadStart).length === 5
  const unloadEndReady = timePart(unloadEnd).length === 5
  const unloadPeriodInvalid = unloading && unloadStartReady && unloadEndReady && isBefore(unloadEnd, unloadStart)

  return (
    <div className="page">
      <TripHeader
        number={doc.trip_number}
        status={doc.status}
        onBack={onBack}
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <button className="btn ghost danger" onClick={onCancel} disabled={busy}>
              <Icon name="x" size={14} />Аннулировать
            </button>
          </div>
        }
      />

      <div className="split-360">
        <div className="col gap-16">
          <div>
            <PlanningForm value={form} onChange={onField} state="active" showCosts={showCosts} readonly={!canEditTransportPlanning} />
            {canEditTransportPlanning && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn sm primary" onClick={onSaveFields} disabled={busy}>
                  <Icon name="save" size={13} />Сохранить транспорт
                </button>
              </div>
            )}
          </div>

          <ReceiptsBlock
            receipts={receipts}
            enrich={enrich}
            onOpen={onOpenReceipt}
            link={link}
            expandable
            resetKey={doc.id}
          />

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="warehouse" state="active">
            {!unloading ? (
              <div className="form-grid-2" style={{ alignItems: 'end' }}>
                <div>
                  <FieldLabel required>Прибытие</FieldLabel>
                  <DateTimeField value={arrival} onChange={onArrivalChange} />
                </div>
                <div>
                  <button className="btn primary" onClick={onArrival} disabled={busy || !arrivalReady}>
                    <Icon name="truckIn" size={15} />Машина приехала
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="form-grid-2">
                  <div>
                    <FieldLabel required>Начало разгрузки</FieldLabel>
                    <DateTimeField value={unloadStart} onChange={onUnloadStartChange} />
                  </div>
                  <div>
                    <FieldLabel required>Окончание разгрузки</FieldLabel>
                    <DateTimeField value={unloadEnd} onChange={onUnloadEndChange} />
                  </div>
                  <div>
                    <FieldLabel>Загруженность</FieldLabel>
                    <Segmented
                      value={loadFactor}
                      options={[
                        { value: 'full', label: TRIP_LOAD_LABELS.full, icon: 'check' },
                        { value: 'partial', label: TRIP_LOAD_LABELS.partial, icon: 'alert' },
                      ]}
                      onChange={onLoadFactor}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn sm primary" onClick={onUnload} disabled={busy || !unloadStartReady || !unloadEndReady || unloadPeriodInvalid}>
                    <Icon name="check" size={13} />Завершить разгрузку
                  </button>
                </div>
                {unloadPeriodInvalid && (
                  <div className="row gap-8" style={{ alignItems: 'center', marginTop: 10, fontSize: 12, color: 'var(--c-warning)' }}>
                    <Icon name="alert" size={13} style={{ flexShrink: 0 }} />
                    <span>Окончание разгрузки не может быть раньше начала разгрузки.</span>
                  </div>
                )}
              </>
            )}
          </PhaseBlock>

          {showCosts && (
            <PhaseBlock icon="ruble" title="Закрытие и стоимость" role="manager" state="locked" hint="После разгрузки">
              <LockedCostFields />
            </PhaseBlock>
          )}
        </div>

        <div className="col gap-16">
          <ProcessPanel status={doc.status} ops={ops} />
          {showCosts && <CostPanel estimate={doc.cost_estimate} />}
          <JournalPanel ops={ops} />
        </div>
      </div>
    </div>
  )
}
