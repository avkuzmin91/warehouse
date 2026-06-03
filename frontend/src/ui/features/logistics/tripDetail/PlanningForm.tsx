import type { CSSProperties } from 'react'
import { useLookups } from '../../../../hooks/useLookups'
import { PhaseBlock } from '../components/PhaseBlock'
import type { PhaseState } from '../components/PhaseBlock'
import { SelectField, MoneyField, FieldLabel } from '../components/fields'
import type { SelectOption } from '../components/fields'

export type PlanningFormValue = {
  origin_id: string
  carrier_id: string
  vehicle_type_id: string
  transport_ordered_at: string
  eta: string
  cost_estimate: string
  comment: string
}

const dtStyle: CSSProperties = {
  width: '100%', height: 34, padding: '0 10px', borderRadius: 'var(--r-md)',
  border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-elev)',
  fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--c-text)',
}

/** Фазовый блок «Планирование транспорта» с полями. Общий для create и draft-detail. */
export function PlanningForm({ value, onChange, state = 'active' }: {
  value: PlanningFormValue
  onChange: (patch: Partial<PlanningFormValue>) => void
  state?: PhaseState
}) {
  const { warehouses, carriers, vehicleTypes } = useLookups()
  const toOpts = (xs: { id: string; name: string }[]): SelectOption[] => xs.map((x) => ({ id: x.id, name: x.name }))

  return (
    <PhaseBlock icon="edit" title="Планирование транспорта" role="manager" state={state}>
      <div className="form-grid-2">
        <div>
          <FieldLabel required>Откуда</FieldLabel>
          <SelectField value={value.origin_id} options={toOpts(warehouses)} leadIcon="map" placeholder="Выберите склад"
            onChange={(id) => onChange({ origin_id: id })} />
        </div>
        <div>
          <FieldLabel required>Перевозчик</FieldLabel>
          <SelectField value={value.carrier_id} options={toOpts(carriers)} leadIcon="truckIn" placeholder="Выберите перевозчика"
            onChange={(id) => onChange({ carrier_id: id })} />
        </div>
        <div>
          <FieldLabel required>Тип кузова</FieldLabel>
          <SelectField value={value.vehicle_type_id} options={toOpts(vehicleTypes)} leadIcon="truckIn" placeholder="Выберите тип"
            onChange={(id) => onChange({ vehicle_type_id: id })} />
        </div>
        <div>
          <FieldLabel required>Стоимость логистики (план)</FieldLabel>
          <MoneyField value={value.cost_estimate} onChange={(v) => onChange({ cost_estimate: v })} />
        </div>
        <div>
          <FieldLabel>Транспорт заказан</FieldLabel>
          <input type="datetime-local" style={dtStyle} value={value.transport_ordered_at.slice(0, 16)}
            onChange={(e) => onChange({ transport_ordered_at: e.target.value })} />
        </div>
        <div>
          <FieldLabel>Плановое прибытие</FieldLabel>
          <input type="datetime-local" style={dtStyle} value={value.eta.slice(0, 16)}
            onChange={(e) => onChange({ eta: e.target.value })} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <FieldLabel>Комментарий</FieldLabel>
          <textarea className="input" rows={2} value={value.comment} placeholder="Догруз, ворота, особенности разгрузки…"
            onChange={(e) => onChange({ comment: e.target.value })} style={{ resize: 'vertical' }} />
        </div>
      </div>
    </PhaseBlock>
  )
}
