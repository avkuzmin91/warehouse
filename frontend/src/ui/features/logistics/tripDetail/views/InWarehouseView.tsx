import { useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../../../../primitives/Icon'
import { TRIP_LOAD_LABELS, tripLexicon } from '../../../../../api/tripsApi'
import type { TripDetail, TripDirection, TripLoadFactor } from '../../../../../api/tripsApi'
import { TripHeader } from '../TripHeader'
import { PlanningForm } from '../PlanningForm'
import type { PlanningFormValue } from '../PlanningForm'
import { PhaseBlock } from '../../components/PhaseBlock'
import { DateTimeField, FieldLabel, Segmented } from '../../components/fields'
import { timePart } from '../../components/dateTimeValue'
import { ReceiptsBlock } from '../ReceiptsBlock'
import type { ReceiptLink, ReceiptEnrich } from '../ReceiptsBlock'
import { ProcessPanel, CostPanel, JournalPanel } from '../panels'

function LockedCostFields({ after }: { after: string }) {
  return (
    <div className="form-grid-2">
      {['Логистика (факт)', 'Стоимость простоя'].map((label) => (
        <div key={label}>
          <FieldLabel>{label}</FieldLabel>
          <div style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>{after}</div>
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

export function InWarehouseView({ detail, form, onField, showCosts, canEditTransportPlanning, dirtyFields, link, enrich, loadFactor, onLoadFactor, arrival, onArrivalChange, unloadStart, onUnloadStartChange, unloadEnd, onUnloadEndChange, busy, onBack, onCancel, onSaveFields, onArrival, onUnload, onOpenReceipt, docsNode }: {
  detail: TripDetail
  form: PlanningFormValue
  onField: (patch: Partial<PlanningFormValue>) => void
  showCosts: boolean
  canEditTransportPlanning: boolean
  dirtyFields: boolean
  link?: ReceiptLink
  enrich?: ReceiptEnrich
  loadFactor: TripLoadFactor | ''
  onLoadFactor: (v: TripLoadFactor | '') => void
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
  docsNode?: ReactNode
}) {
  const { doc, ops, receipts } = detail
  const direction = (doc.direction as TripDirection) ?? 'inbound'
  const lex = tripLexicon(direction)
  const unloading = doc.status === 'unloading'
  const arrivalReady = timePart(arrival).length === 5
  const unloadStartReady = timePart(unloadStart).length === 5
  const unloadEndReady = timePart(unloadEnd).length === 5
  const unloadPeriodInvalid = unloading && unloadStartReady && unloadEndReady && isBefore(unloadEnd, unloadStart)
  const [showReasons, setShowReasons] = useState(false)
  const blockReasons: string[] = unloading
    ? [
        ...(!unloadStartReady ? [`Не указано «${lex.unloadStartLabel}»`] : []),
        ...(!unloadEndReady ? [`Не указано «${lex.unloadEndLabel}»`] : []),
        ...(unloadPeriodInvalid ? [lex.periodInvalid] : []),
        ...(!loadFactor ? ['Не выбрана загруженность машины'] : []),
      ]
    : (!arrivalReady ? [`Не указано «${lex.arrivalLabel}»`] : [])
  const handleAction = () => {
    if (blockReasons.length > 0) { setShowReasons(true); return }
    setShowReasons(false)
    if (unloading) onUnload()
    else onArrival()
  }
  const reasonsVisible = showReasons && blockReasons.length > 0

  return (
    <div className="page">
      <TripHeader
        number={doc.trip_number}
        status={doc.status}
        direction={direction}
        cargoType={doc.cargo_type}
        onBack={onBack}
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <button className="btn ghost danger" onClick={onCancel} disabled={busy}>
              <Icon name="x" size={14} />Аннулировать
            </button>
            {canEditTransportPlanning && dirtyFields && (
              <button className="btn" onClick={onSaveFields} disabled={busy}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
          </div>
        }
      />

      <div className="split-360">
        <div className="col gap-16">
          <PlanningForm value={form} onChange={onField} state="active" showCosts={showCosts} readonly={!canEditTransportPlanning} routeLabel={lex.routeLabel} etaLabel={lex.etaLabel} />

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

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="warehouse" state="active">
            {!unloading ? (
              <>
                <div className="form-grid-2" style={{ alignItems: 'end' }}>
                  <div>
                    <FieldLabel required>{lex.arrivalLabel}</FieldLabel>
                    <DateTimeField value={arrival} invalid={showReasons && !arrivalReady} onChange={onArrivalChange} />
                  </div>
                  <div>
                    <button className="btn primary" onClick={handleAction} disabled={busy}>
                      <Icon name="truckIn" size={15} />{lex.arrivedAction}
                    </button>
                  </div>
                </div>
                {reasonsVisible && (
                  <div className="block-reasons" style={{ textAlign: 'left', marginTop: 10 }}>
                    {blockReasons.map((r, i) => (
                      <div key={i}>· {r}</div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="form-grid-2">
                  <div>
                    <FieldLabel required>{lex.unloadStartLabel}</FieldLabel>
                    <DateTimeField value={unloadStart} invalid={showReasons && !unloadStartReady} onChange={onUnloadStartChange} />
                  </div>
                  <div>
                    <FieldLabel required>{lex.unloadEndLabel}</FieldLabel>
                    <DateTimeField value={unloadEnd} invalid={showReasons && !unloadEndReady} onChange={onUnloadEndChange} />
                  </div>
                  <div>
                    <FieldLabel required>Загруженность</FieldLabel>
                    <Segmented
                      value={loadFactor}
                      invalid={showReasons && !loadFactor}
                      options={[
                        { value: 'full', label: TRIP_LOAD_LABELS.full, icon: 'check', tone: 'success' },
                        { value: 'partial', label: TRIP_LOAD_LABELS.partial, icon: 'alert', tone: 'warning' },
                      ]}
                      onChange={onLoadFactor}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn sm primary" onClick={handleAction} disabled={busy}>
                    <Icon name="check" size={13} />{lex.finishAction}
                  </button>
                </div>
                {reasonsVisible ? (
                  <div className="block-reasons" style={{ textAlign: 'left', marginTop: 10 }}>
                    {blockReasons.map((r, i) => (
                      <div key={i}>· {r}</div>
                    ))}
                  </div>
                ) : unloadPeriodInvalid && (
                  <div className="row gap-8" style={{ alignItems: 'center', marginTop: 10, fontSize: 12, color: 'var(--c-warning)' }}>
                    <Icon name="alert" size={13} style={{ flexShrink: 0 }} />
                    <span>{lex.periodInvalid}</span>
                  </div>
                )}
              </>
            )}
          </PhaseBlock>

          {showCosts && (
            <PhaseBlock icon="ruble" title="Закрытие и стоимость" role="manager" state="locked" hint={`После ${lex.warehousePhaseGen}`}>
              <LockedCostFields after={`после ${lex.warehousePhaseGen}`} />
            </PhaseBlock>
          )}
        </div>

        <div className="col gap-16">
          <ProcessPanel status={doc.status} ops={ops} direction={direction} />
          {showCosts && <CostPanel estimate={doc.cost_estimate} />}
          <JournalPanel ops={ops} />
        </div>
      </div>
    </div>
  )
}
