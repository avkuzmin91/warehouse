import type { DictionaryItem } from '../../api/lookupsApi'
import { Combobox } from '../../components/Combobox'
import { DateTimeField } from '../../components/DateTimeField'
import { TextArea } from '../../components/TextArea'

// Поля планирования рейса — общие для создания и редактирования черновика в деталке.
export type PlanningValue = {
  originId: string
  carrierId: string
  vehicleTypeId: string
  vehicleNumber: string
  orderedAt: string
  eta: string
  costEstimate: string
  comment: string
}

export const EMPTY_PLANNING: PlanningValue = {
  originId: '', carrierId: '', vehicleTypeId: '', vehicleNumber: '',
  orderedAt: '', eta: '', costEstimate: '', comment: '',
}

export function TripPlanningFields({
  value,
  onChange,
  warehouses,
  carriers,
  vehicleTypes,
  routeLabel,
  etaLabel,
  etaInvalid,
}: {
  value: PlanningValue
  onChange: (patch: Partial<PlanningValue>) => void
  warehouses: DictionaryItem[]
  carriers: DictionaryItem[]
  vehicleTypes: DictionaryItem[]
  routeLabel: string
  etaLabel: string
  etaInvalid?: boolean
}) {
  return (
    <>
      <div className="field">
        <div className="flabel">{routeLabel} <span className="req">*</span></div>
        <Combobox
          value={value.originId}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          placeholder="Выберите точку…"
          title={routeLabel}
          onChange={(v) => onChange({ originId: v })}
        />
      </div>

      <div className="field">
        <div className="flabel">Перевозчик <span className="req">*</span></div>
        <Combobox
          value={value.carrierId}
          options={carriers.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Выберите перевозчика…"
          title="Перевозчик"
          onChange={(v) => onChange({ carrierId: v })}
        />
      </div>

      <div className="field">
        <div className="flabel">Тип кузова <span className="req">*</span></div>
        <Combobox
          value={value.vehicleTypeId}
          options={vehicleTypes.map((v) => ({ value: v.id, label: v.name }))}
          placeholder="Выберите тип кузова…"
          title="Тип кузова"
          onChange={(v) => onChange({ vehicleTypeId: v })}
        />
      </div>

      <div className="field">
        <div className="flabel">Гос. номер <span className="req">*</span></div>
        <input
          className="input"
          type="text"
          autoCapitalize="characters"
          placeholder="А000АА 000"
          value={value.vehicleNumber}
          onChange={(e) => onChange({ vehicleNumber: e.target.value })}
        />
      </div>

      <div className="field">
        <div className="flabel">Транспорт заказан <span className="req">*</span></div>
        <DateTimeField value={value.orderedAt} onChange={(v) => onChange({ orderedAt: v })} title="Транспорт заказан" />
      </div>

      <div className="field">
        <div className="flabel">{etaLabel} <span className="req">*</span></div>
        <DateTimeField value={value.eta} onChange={(v) => onChange({ eta: v })} title={etaLabel} invalid={etaInvalid} />
        {etaInvalid && <div className="line-sub hint-danger" style={{ marginTop: 4 }}>Раньше заказа транспорта</div>}
      </div>

      <div className="field">
        <div className="flabel">Стоимость логистики (план), ₽ <span className="req">*</span></div>
        <input
          className="input num"
          inputMode="numeric"
          placeholder="0"
          value={value.costEstimate}
          onChange={(e) => onChange({ costEstimate: e.target.value.replace(/[^\d]/g, '') })}
        />
      </div>

      <div className="field">
        <div className="flabel">Комментарий</div>
        <TextArea
          minRows={2}
          placeholder="Примечание для склада"
          value={value.comment}
          onChange={(comment) => onChange({ comment })}
        />
      </div>
    </>
  )
}
