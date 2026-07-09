import { useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../../../../primitives/Icon'
import type { IconName } from '../../../../primitives/Icon'
import type { TripDetail, TripDirection } from '../../../../../api/tripsApi'
import { TRIP_LOAD_LABELS, tripLexicon } from '../../../../../api/tripsApi'
import { TripHeader } from '../TripHeader'
import { ReadRow, SelectField } from '../../components/fields'
import { ReceiptsBlock } from '../ReceiptsBlock'
import { Panel, ProcessPanel, CostPanel, JournalButton } from '../panels'
import { fmtDateTime } from '../format'

/** Инлайн-смена перевозчика на карточке закрытого рейса (только админ). */
export type CarrierEdit = {
  carriers: { id: string; name: string }[]
  currentId: string | null
  onSave: (carrierId: string) => void
  busy: boolean
}

function CarrierRow({ name, edit }: { name: string | null; edit?: CarrierEdit }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  if (!edit) return <ReadRow label="Перевозчик">{name ?? '—'}</ReadRow>
  if (!editing) {
    return (
      <ReadRow label="Перевозчик">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {name ?? '—'}
          <button
            className="btn ghost sm icon"
            title="Изменить перевозчика"
            onClick={() => { setDraft(edit.currentId ?? ''); setEditing(true) }}
          >
            <Icon name="edit" size={13} />
          </button>
        </span>
      </ReadRow>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
      <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)', flexShrink: 0 }}>Перевозчик</span>
      <div style={{ flex: 1, minWidth: 0, maxWidth: 220, marginLeft: 'auto' }}>
        <SelectField value={draft} options={edit.carriers} leadIcon="truckIn" placeholder="Выберите перевозчика"
          onChange={setDraft} />
      </div>
      <button className="btn primary sm" disabled={edit.busy || !draft || draft === edit.currentId}
        onClick={() => { edit.onSave(draft); setEditing(false) }}>Сохранить</button>
      <button className="btn ghost sm" disabled={edit.busy} onClick={() => setEditing(false)}>Отмена</button>
    </div>
  )
}

function money(v: number | null | undefined): string {
  return v == null ? '—' : `${v.toLocaleString('ru-RU')} ₽`
}

function durationMin(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  return Math.round(ms / 60000)
}

function Kpi({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 6 }}>
        <Icon name={icon} size={14} style={{ color: 'var(--c-text-subtle)' }} />{label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

export function ClosedView({ detail, showCosts, onBack, onOpenReceipt, docsNode, carrierEdit, onCancel, busy }: {
  detail: TripDetail
  showCosts: boolean
  onBack: () => void
  onOpenReceipt: (id: string) => void
  docsNode?: ReactNode
  carrierEdit?: CarrierEdit
  onCancel?: () => void
  busy?: boolean
}) {
  const { doc, ops, receipts } = detail
  const direction = (doc.direction as TripDirection) ?? 'inbound'
  const lex = tripLexicon(direction)
  const closed = doc.status === 'closed'
  const total = (doc.logistics_cost_actual ?? 0) + (doc.waiting_cost ?? 0)
  const unloadMin = durationMin(doc.unload_started_at ?? doc.arrived_at, doc.unload_finished_at)

  return (
    <div className="page">
      <TripHeader
        number={doc.trip_number}
        status={doc.status}
        direction={direction}
        cargoType={doc.cargo_type}
        initiator={{ name: doc.created_by_name, createdAt: doc.created_at }}
        onBack={onBack}
        action={
          <div className="row gap-8">
            <JournalButton ops={ops} tripNumber={doc.trip_number} />
            {closed && onCancel && (
              <button className="btn danger" disabled={busy} onClick={onCancel}>
                <Icon name="alert" size={14} />Аннулировать
              </button>
            )}
            <button className="btn" onClick={() => window.print()}>
              <Icon name="download" size={14} />Экспорт
            </button>
          </div>
        }
      />

      {closed && (
        <div style={{ display: 'grid', gridTemplateColumns: showCosts ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)', gap: 12, marginBottom: 18 }}>
          {showCosts && <Kpi icon="ruble" label="Итого по рейсу" value={money(total)} />}
          <Kpi icon="forklift" label={lex.warehousePhase} value={unloadMin != null ? `${unloadMin} мин` : '—'} />
          {showCosts && <Kpi icon="clock" label="Простой" value={`${doc.waiting_minutes ?? 0} мин · ${money(doc.waiting_cost)}`} />}
          <Kpi icon="check" label="Загруженность" value={doc.load_factor ? TRIP_LOAD_LABELS[doc.load_factor] : '—'} />
        </div>
      )}

      <div className="split-360">
        <div className="col gap-16">
          <Panel icon="map" title="Планирование транспорта">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28, rowGap: 0 }}>
              <ReadRow label={lex.routeLabel}>{doc.origin_name ?? '—'}</ReadRow>
              <CarrierRow name={doc.carrier_name} edit={carrierEdit} />
              <ReadRow label="Тип кузова">{doc.vehicle_type_name ?? '—'}</ReadRow>
              <ReadRow label="Гос. номер">{doc.vehicle_number ?? '—'}</ReadRow>
              <ReadRow label="Транспорт заказан" mono>{fmtDateTime(doc.transport_ordered_at)}</ReadRow>
              <ReadRow label={lex.etaLabel} mono>{fmtDateTime(doc.eta)}</ReadRow>
              {showCosts && <ReadRow label="Стоимость логистики (план)" mono>{money(doc.cost_estimate)}</ReadRow>}
              <div style={{ gridColumn: '1 / -1' }}>
                <ReadRow label="Комментарий">{doc.comment ?? '—'}</ReadRow>
              </div>
            </div>
          </Panel>

          <Panel icon="forklift" title="Исполнение на складе">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 28, rowGap: 0 }}>
              <ReadRow label={lex.arrivalLabel} mono>{fmtDateTime(doc.arrived_at)}</ReadRow>
              <ReadRow label={lex.unloadStartLabel} mono>{fmtDateTime(doc.unload_started_at ?? doc.arrived_at)}</ReadRow>
              <ReadRow label={lex.unloadEndLabel} mono>{fmtDateTime(doc.unload_finished_at)}</ReadRow>
              <ReadRow label="Загруженность">{doc.load_factor ? TRIP_LOAD_LABELS[doc.load_factor] : '—'}</ReadRow>
              {unloadMin != null && <ReadRow label={`Длительность ${lex.warehousePhaseGen}`}><span style={{ color: 'var(--c-info)' }}>{unloadMin} мин</span></ReadRow>}
            </div>
          </Panel>

          {docsNode ?? (
            <ReceiptsBlock
              receipts={receipts}
              onOpen={onOpenReceipt}
              expandable
              resetKey={doc.id}
              footerNote={
                <div style={{ display: 'flex', gap: 6, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                  <Icon name="alert" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>Рейс {closed ? 'закрыт' : 'аннулирован'} независимо от приёмки — поступления досчитываются своим процессом.</span>
                </div>
              }
            />
          )}
        </div>

        <div className="col gap-16">
          <ProcessPanel status={doc.status} ops={ops} direction={direction} />
          {showCosts && <CostPanel estimate={doc.cost_estimate} actual={doc.logistics_cost_actual} waiting={doc.waiting_cost} showActual={closed} />}
        </div>
      </div>
    </div>
  )
}
