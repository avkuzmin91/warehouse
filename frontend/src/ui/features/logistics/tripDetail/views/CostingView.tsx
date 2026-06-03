import { useState } from 'react'
import { Icon } from '../../../../primitives/Icon'
import { TRIP_LOAD_LABELS } from '../../../../../api/tripsApi'
import type { TripDetail, TripLoadFactor } from '../../../../../api/tripsApi'
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

export function CostingView({ detail, form, onField, cost, onCost, dirtyCost, onSaveCost, onSaveFields, arrival, onArrivalChange, unloadStart, onUnloadStartChange, unloadEnd, onUnloadEndChange, loadFactor, onLoadFactor, onSaveExecution, busy, onBack, onCancel, onClose, onOpenReceipt }: {
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
  onBack: () => void
  onCancel: () => void
  onClose: () => void
  onOpenReceipt: (id: string) => void
}) {
  const { doc, ops, receipts } = detail
  const [editTransport, setEditTransport] = useState(false)
  const [editExecution, setEditExecution] = useState(false)
  const total = (Number(cost.logistics_cost_actual) || 0) + (Number(cost.waiting_cost) || 0)
  const dur = durationMin(doc.unload_started_at ?? doc.arrived_at, doc.unload_finished_at)

  return (
    <div className="page">
      <TripHeader
        number={doc.trip_number}
        status="costing"
        onBack={onBack}
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <button className="btn ghost danger" onClick={onCancel} disabled={busy}>
              <Icon name="x" size={14} />Аннулировать
            </button>
            <PrimaryAction icon="check" label="Закрыть рейс" hint="Поступления досчитываются отдельным процессом"
              onClick={onClose} disabled={busy} />
          </div>
        }
      />

      <div className="split-360">
        <div className="col gap-16">
          {editTransport ? (
            <div>
              <PlanningForm value={form} onChange={onField} state="active" />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn sm primary" onClick={() => { onSaveFields(); setEditTransport(false) }} disabled={busy}>
                  <Icon name="save" size={13} />Сохранить транспорт
                </button>
                <button className="btn sm ghost" onClick={() => setEditTransport(false)}>Отмена</button>
              </div>
            </div>
          ) : (
            <PhaseBlock icon="edit" title="Планирование транспорта" role="manager" state="done"
              action={
                <button className="btn sm ghost" onClick={() => setEditTransport(true)}>
                  <Icon name="edit" size={13} />Изменить транспорт
                </button>
              }>
              <div className="form-grid-2">
                <ReadRow label="Откуда">{doc.origin_name ?? '—'}</ReadRow>
                <ReadRow label="Перевозчик">{doc.carrier_name ?? '—'}</ReadRow>
                <ReadRow label="Тип кузова">{doc.vehicle_type_name ?? '—'}</ReadRow>
                <ReadRow label="Стоимость логистики (план)" mono>{doc.cost_estimate != null ? money(doc.cost_estimate) : '—'}</ReadRow>
                <ReadRow label="Транспорт заказан" mono>{fmtDateTime(doc.transport_ordered_at)}</ReadRow>
                <ReadRow label="Плановое прибытие" mono>{fmtDateTime(doc.eta)}</ReadRow>
                <div style={{ gridColumn: '1 / -1' }}>
                  <ReadRow label="Комментарий">{doc.comment ?? '—'}</ReadRow>
                </div>
              </div>
            </PhaseBlock>
          )}

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="warehouse" state="done"
            action={!editExecution && (
              <button className="btn sm ghost" onClick={() => setEditExecution(true)}>
                <Icon name="edit" size={13} />Изменить
              </button>
            )}>
            {editExecution ? (
              <div>
                <div className="form-grid-2">
                  <div>
                    <FieldLabel>Прибытие</FieldLabel>
                    <DateTimeField value={arrival} onChange={onArrivalChange} />
                  </div>
                  <div>
                    <FieldLabel>Начало разгрузки</FieldLabel>
                    <DateTimeField value={unloadStart} onChange={onUnloadStartChange} />
                  </div>
                  <div>
                    <FieldLabel>Окончание разгрузки</FieldLabel>
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
              <div className="form-grid-2">
                <ReadRow label="Прибытие" mono>{fmtDateTime(doc.arrived_at)}</ReadRow>
                <ReadRow label="Начало разгрузки" mono>{fmtDateTime(doc.unload_started_at ?? doc.arrived_at)}</ReadRow>
                <ReadRow label="Окончание разгрузки" mono>{fmtDateTime(doc.unload_finished_at)}</ReadRow>
                <ReadRow label="Загруженность">{doc.load_factor ? TRIP_LOAD_LABELS[doc.load_factor] : '—'}</ReadRow>
                {dur != null && <ReadRow label="Длительность разгрузки"><span style={{ color: 'var(--c-info)' }}>{dur} мин</span></ReadRow>}
              </div>
            )}
          </PhaseBlock>

          <PhaseBlock icon="ruble" title="Закрытие и стоимость" role="manager" state="active">
            <div className="form-grid-2">
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
              marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: 'var(--r-md)', background: 'var(--c-accent-bg)',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 500, color: 'var(--c-accent-text)' }}>
                <Icon name="ruble" size={14} />Итого по рейсу
              </span>
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-accent-text)' }}>{money(total)}</span>
            </div>
            {dirtyCost && (
              <button className="btn sm" style={{ marginTop: 10 }} onClick={onSaveCost} disabled={busy}>
                <Icon name="save" size={13} />Сохранить стоимость
              </button>
            )}
          </PhaseBlock>

          <ReceiptsBlock receipts={receipts} onOpen={onOpenReceipt} />
        </div>

        <div className="col gap-16">
          <ProcessPanel status="costing" ops={ops} />
          <CostPanel estimate={doc.cost_estimate} actual={Number(cost.logistics_cost_actual) || null} waiting={Number(cost.waiting_cost) || null} showActual />
          <JournalPanel ops={ops} />
        </div>
      </div>
    </div>
  )
}
