import { useLookups } from '../../../../hooks/useLookups'
import { PhaseBlock } from '../components/PhaseBlock'
import type { PhaseState } from '../components/PhaseBlock'
import { SelectField, MoneyField, FieldLabel, DateTimeField } from '../components/fields'
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

/** Фазовый блок «Планирование транспорта» с полями. Общий для create и draft-detail. */
export function PlanningForm({ value, onChange, state = 'active', invalid }: {
  value: PlanningFormValue
  onChange: (patch: Partial<PlanningFormValue>) => void
  state?: PhaseState
  invalid?: Partial<Record<keyof PlanningFormValue, boolean>>
}) {
  const { warehouses, carriers, vehicleTypes } = useLookups()
  const toOpts = (xs: { id: string; name: string }[]): SelectOption[] => xs.map((x) => ({ id: x.id, name: x.name }))

  return (
    <PhaseBlock icon="edit" title="Планирование транспорта" role="manager" state={state}>
      <div className="form-grid-2">
        <div>
          <FieldLabel required>Откуда</FieldLabel>
          <SelectField value={value.origin_id} options={toOpts(warehouses)} leadIcon="map" placeholder="Выберите склад"
            invalid={invalid?.origin_id} onChange={(id) => onChange({ origin_id: id })} />
        </div>
        <div>
          <FieldLabel required>Перевозчик</FieldLabel>
          <SelectField value={value.carrier_id} options={toOpts(carriers)} leadIcon="truckIn" placeholder="Выберите перевозчика"
            invalid={invalid?.carrier_id} onChange={(id) => onChange({ carrier_id: id })} />
        </div>
        <div>
          <FieldLabel required>Тип кузова</FieldLabel>
          <SelectField value={value.vehicle_type_id} options={toOpts(vehicleTypes)} leadIcon="truckIn" placeholder="Выберите тип"
            invalid={invalid?.vehicle_type_id} onChange={(id) => onChange({ vehicle_type_id: id })} />
        </div>
        <div>
          <FieldLabel required>Стоимость логистики (план)</FieldLabel>
          <MoneyField value={value.cost_estimate} invalid={invalid?.cost_estimate} onChange={(v) => onChange({ cost_estimate: v })} />
        </div>
        <div>
          <FieldLabel required>Транспорт заказан</FieldLabel>
          <DateTimeField value={value.transport_ordered_at} invalid={invalid?.transport_ordered_at} onChange={(v) => onChange({ transport_ordered_at: v })} />
        </div>
        <div>
          <FieldLabel required>Плановое прибытие</FieldLabel>
          <DateTimeField value={value.eta} invalid={invalid?.eta} onChange={(v) => onChange({ eta: v })} />
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
