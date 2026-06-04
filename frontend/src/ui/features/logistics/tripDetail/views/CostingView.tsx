import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../../../../primitives/Icon'
import { TRIP_LOAD_LABELS, tripLexicon } from '../../../../../api/tripsApi'
import type { TripDetail, TripDirection, TripLoadFactor } from '../../../../../api/tripsApi'
import { TripHeader, PrimaryAction } from '../TripHeader'
import { PlanningForm } from '../PlanningForm'
import type { PlanningFormValue } from '../PlanningForm'
import { PhaseBlock } from '../../components/PhaseBlock'
import { DateTimeField, MoneyField, ReadRow, FieldLabel, Segmented } from '../../components/fields'
import { ReceiptsBlock } from '../ReceiptsBlock'
import { ProcessPanel, CostPanel, JournalPanel } from '../panels'
import { fmtDateTime } from '../format'

export type CostForm = { logistics_cost_actual: string; waiting_cost: string; waiting_minutes: string }

function money(v: number): string {
  return `${v.toLocaleString('ru-RU')} ₽`
}

function durationMin(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  return Math.round(ms / 60000)
}

export function CostingView({ detail, form, onField, cost, onCost, dirtyCost, onSaveCost, onSaveFields, arrival, onArrivalChange, unloadStart, onUnloadStartChange, unloadEnd, onUnloadEndChange, loadFactor, onLoadFactor, onSaveExecution, busy, showCosts, canEditTransportPlanning, canEditExecution, onBack, onCancel, onClose, onOpenReceipt, docsNode }: {
  detail: TripDetail
  form: PlanningFormValue
  onField: (patch: Partial<PlanningFormValue>) => void
  cost: CostForm
  onCost: (patch: Partial<CostForm>) => void
  dirtyCost: boolean
  onSaveCost: () => void
  onSaveFields: () => void
  arrival: string
  onArrivalChange: (v: string) => void
  unloadStart: string
  onUnloadStartChange: (v: string) => void
  unloadEnd: string
  onUnloadEndChange: (v: string) => void
  loadFactor: TripLoadFactor
  onLoadFactor: (v: TripLoadFactor) => void
  onSaveExecution: () => void
  busy: boolean
  showCosts: boolean
  canEditTransportPlanning: boolean
  canEditExecution: boolean
  onBack: () => void
  onCancel: () => void
  onClose: () => void
  onOpenReceipt: (id: string) => void
  docsNode?: ReactNode
}) {
  const { doc, ops, receipts } = detail
  const direction = (doc.direction as TripDirection) ?? 'inbound'
  const lex = tripLexicon(direction)
  const outbound = direction === 'outbound'
  const [editTransport, setEditTransport] = useState(false)
  const [editExecution, setEditExecution] = useState(false)
  const total = (Number(cost.logistics_cost_actual) || 0) + (Number(cost.waiting_cost) || 0)
  const dur = durationMin(doc.unload_started_at ?? doc.arrived_at, doc.unload_finished_at)

  useEffect(() => {
    if (!canEditTransportPlanning) setEditTransport(false)
    if (!canEditExecution) setEditExecution(false)
  }, [canEditExecution, canEditTransportPlanning])

  return (
    <div className="page">
      <TripHeader
        number={doc.trip_number}
        status="costing"
        direction={direction}
        onBack={onBack}
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <button className="btn ghost danger" onClick={onCancel} disabled={busy}>
              <Icon name="x" size={14} />Аннулировать
            </button>
            {showCosts && (
              <PrimaryAction icon="check" label="Закрыть рейс"
                hint={outbound ? 'Отгрузки уже списаны при завершении погрузки' : 'Поступления досчитываются отдельным процессом'}
                onClick={onClose} disabled={busy} />
            )}
          </div>
        }
      />

      <div className="split-360">
        <div className="col gap-16">
          {editTransport && canEditTransportPlanning ? (
            <div>
              <PlanningForm value={form} onChange={onField} state="active" showCosts={showCosts} routeLabel={lex.routeLabel} etaLabel={lex.etaLabel} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn sm primary" onClick={() => { onSaveFields(); setEditTransport(false) }} disabled={busy}>
                  <Icon name="save" size={13} />Сохранить транспорт
                </button>
                <button className="btn sm ghost" onClick={() => setEditTransport(false)}>Отмена</button>
              </div>
            </div>
          ) : (
            <PhaseBlock icon="edit" title="Планирование транспорта" role="manager" state="done"
              action={canEditTransportPlanning ? (
                <button className="btn sm ghost" onClick={() => setEditTransport(true)}>
                  <Icon name="edit" size={13} />Изменить транспорт
                </button>
              ) : undefined}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28, rowGap: 0 }}>
                <ReadRow label={lex.routeLabel}>{doc.origin_name ?? '—'}</ReadRow>
                <ReadRow label="Перевозчик">{doc.carrier_name ?? '—'}</ReadRow>
                <ReadRow label="Тип кузова">{doc.vehicle_type_name ?? '—'}</ReadRow>
                {showCosts && (
                  <ReadRow label="Стоимость логистики (план)" mono>{doc.cost_estimate != null ? money(doc.cost_estimate) : '—'}</ReadRow>
                )}
                <ReadRow label="Транспорт заказан" mono>{fmtDateTime(doc.transport_ordered_at)}</ReadRow>
                <ReadRow label={lex.etaLabel} mono>{fmtDateTime(doc.eta)}</ReadRow>
                <div style={{ gridColumn: '1 / -1' }}>
                  <ReadRow label="Комментарий">{doc.comment ?? '—'}</ReadRow>
                </div>
              </div>
            </PhaseBlock>
          )}

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="warehouse" state="done"
            action={canEditExecution && !editExecution ? (
              <button className="btn sm ghost" onClick={() => setEditExecution(true)}>
                <Icon name="edit" size={13} />Изменить
              </button>
            ) : undefined}>
            {editExecution && canEditExecution ? (
              <div>
                <div className="form-grid-2">
                  <div>
                    <FieldLabel>{lex.arrivalLabel}</FieldLabel>
                    <DateTimeField value={arrival} onChange={onArrivalChange} />
                  </div>
                  <div>
                    <FieldLabel>{lex.unloadStartLabel}</FieldLabel>
                    <DateTimeField value={unloadStart} onChange={onUnloadStartChange} />
                  </div>
                  <div>
                    <FieldLabel>{lex.unloadEndLabel}</FieldLabel>
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
                  <button className="btn sm primary" onClick={() => { onSaveExecution(); setEditExecution(false) }} disabled={busy}>
                    <Icon name="save" size={13} />Сохранить исполнение
                  </button>
                  <button className="btn sm ghost" onClick={() => setEditExecution(false)}>Отмена</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28, rowGap: 0 }}>
                <ReadRow label={lex.arrivalLabel} mono>{fmtDateTime(doc.arrived_at)}</ReadRow>
                <ReadRow label={lex.unloadStartLabel} mono>{fmtDateTime(doc.unload_started_at ?? doc.arrived_at)}</ReadRow>
                <ReadRow label={lex.unloadEndLabel} mono>{fmtDateTime(doc.unload_finished_at)}</ReadRow>
                <ReadRow label="Загруженность">{doc.load_factor ? TRIP_LOAD_LABELS[doc.load_factor] : '—'}</ReadRow>
                {dur != null && <ReadRow label={`Длительность ${lex.warehousePhaseGen}`}><span style={{ color: 'var(--c-info)' }}>{dur} мин</span></ReadRow>}
              </div>
            )}
          </PhaseBlock>

          {showCosts && (
            <PhaseBlock icon="ruble" title="Закрытие и стоимость" role="manager" state="active">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'end' }}>
                <div>
                  <FieldLabel required>Логистика (факт)</FieldLabel>
                  <MoneyField value={cost.logistics_cost_actual} onChange={(v) => onCost({ logistics_cost_actual: v })} />
                </div>
                <div>
                  <FieldLabel>Стоимость простоя</FieldLabel>
                  <MoneyField value={cost.waiting_cost} onChange={(v) => onCost({ waiting_cost: v })} />
                </div>
                <div>
                  <FieldLabel>Время простоя, мин</FieldLabel>
                  <div style={{ display: 'flex', alignItems: 'center', height: 34, padding: '0 10px', borderRadius: 'var(--r-md)', border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-elev)' }}>
                    <input value={cost.waiting_minutes} inputMode="numeric" placeholder="0"
                      onChange={(e) => onCost({ waiting_minutes: e.target.value.replace(/[^\d]/g, '') })}
                      style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: 13.5, fontWeight: 500, textAlign: 'right', minWidth: 0, color: 'var(--c-text)' }} />
                    <span style={{ marginLeft: 6, color: 'var(--c-text-subtle)', fontSize: 13 }}>мин</span>
                  </div>
                </div>
              </div>
              <div style={{
                marginTop: 14, display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 'var(--r-md)',
                background: 'color-mix(in oklab, var(--c-accent) 6%, var(--c-bg-elev))',
                border: '1px solid var(--c-accent-border)',
              }}>
                <Icon name="ruble" size={15} style={{ color: 'var(--c-accent)' }} />
                <span style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>Итого по рейсу</span>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 600 }}>{money(total)}</span>
              </div>
              {dirtyCost && (
                <button className="btn sm" style={{ marginTop: 10 }} onClick={onSaveCost} disabled={busy}>
                  <Icon name="save" size={13} />Сохранить стоимость
                </button>
              )}
            </PhaseBlock>
          )}

          {docsNode ?? <ReceiptsBlock receipts={receipts} onOpen={onOpenReceipt} expandable resetKey={doc.id} />}
        </div>

        <div className="col gap-16">
          <ProcessPanel status="costing" ops={ops} direction={direction} />
          {showCosts && <CostPanel estimate={doc.cost_estimate} actual={Number(cost.logistics_cost_actual) || null} waiting={Number(cost.waiting_cost) || null} showActual />}
          <JournalPanel ops={ops} />
        </div>
      </div>
    </div>
  )
}
