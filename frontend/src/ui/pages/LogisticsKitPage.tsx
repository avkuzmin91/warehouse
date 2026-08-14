import { useState } from 'react'
import type { TripOp } from '../../api/tripsApi'
import { RoleChip } from '../features/logistics/components/RoleChip'
import { ProcessRail } from '../features/logistics/components/ProcessRail'
import { PhaseBlock } from '../features/logistics/components/PhaseBlock'
import { ReceiptCard } from '../features/logistics/components/ReceiptCard'
import { CostLedger } from '../features/logistics/components/CostLedger'
import {
  FieldLabel, SelectField, MoneyField, TimeField, ReadRow, Segmented,
} from '../features/logistics/components/fields'
import type { SelectOption } from '../features/logistics/components/fields'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { canViewCosts } from '../../utils/access'

const op = (op_type: string, created_at: string): TripOp => ({
  id: op_type, trip_id: 't', op_type, comment: null, created_at, created_by: null, created_by_email: null,
})

const OPS: TripOp[] = [
  op('doc_create', '2026-06-02T11:30:00'),
  op('handoff', '2026-06-02T16:30:00'),
  op('arrival', '2026-06-03T14:20:00'),
  op('unload_done', '2026-06-03T15:05:00'),
]

const ORIGINS: SelectOption[] = [
  { id: 'w1', name: 'Москва · Чёрная Грязь' },
  { id: 'w2', name: 'СПб · Шушары' },
  { id: 'w3', name: 'Екатеринбург · Кольцово' },
]
const VEHICLES: SelectOption[] = [
  { id: 'v1', name: 'Тент', icon: 'truckIn' },
  { id: 'v2', name: 'Рефрижератор', icon: 'snow' },
  { id: 'v3', name: 'Изотерм', icon: 'box' },
  { id: 'v4', name: 'Бортовой', icon: 'truckOut' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text-subtle)', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

export function LogisticsKitPage() {
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const [origin, setOrigin] = useState('w1')
  const [vehicle, setVehicle] = useState('v1')
  const [cost, setCost] = useState('48000')
  const [load, setLoad] = useState<'full' | 'partial'>('full')

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-header">
        <div>
          <div className="page-title">Логистика · кит компонентов</div>
          <div className="page-subtitle">Шаг 1/4 — общие блоки редизайна «Рейсы» в изоляции</div>
        </div>
      </div>

      <Section title="RoleChip">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <RoleChip role="manager" />
          <RoleChip role="warehouse" />
          <RoleChip role="manager" faded />
          <RoleChip role="warehouse" faded />
        </div>
      </Section>

      <Section title="ProcessRail (таймлайн фаз из trip_ops)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div className="card" style={{ padding: 12 }}>
            <div className="t-sub" style={{ marginBottom: 6, fontSize: 11 }}>status = draft</div>
            <ProcessRail status="draft" ops={OPS.slice(0, 1)} />
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="t-sub" style={{ marginBottom: 6, fontSize: 11 }}>status = unloading</div>
            <ProcessRail status="unloading" ops={OPS.slice(0, 3)} />
          </div>
          <div className="card" style={{ padding: 12 }}>
            <div className="t-sub" style={{ marginBottom: 6, fontSize: 11 }}>status = costing</div>
            <ProcessRail status="costing" ops={OPS} />
          </div>
        </div>
      </Section>

      <Section title="PhaseBlock (active / locked / done)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock icon="edit" title="Планирование транспорта" role="manager" state="active">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <FieldLabel required>Откуда</FieldLabel>
                <SelectField value={origin} options={ORIGINS} leadIcon="map" onChange={setOrigin} />
              </div>
              <div>
                <FieldLabel required>Тип кузова</FieldLabel>
                <SelectField value={vehicle} options={VEHICLES} leadIcon="truckIn" onChange={setVehicle} />
              </div>
              {showCosts && (
                <div>
                  <FieldLabel required>Стоимость логистики (план)</FieldLabel>
                  <MoneyField value={cost} onChange={setCost} />
                </div>
              )}
              <div>
                <FieldLabel>Транспорт заказан</FieldLabel>
                <TimeField value="02 июн, 11:40" />
              </div>
            </div>
          </PhaseBlock>

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="warehouse" state="locked" hint="Заполнит кладовщик, когда машина приедет" />

          <PhaseBlock icon="forklift" title="Исполнение на складе" role="warehouse" state="done">
            <ReadRow label="Прибытие" mono>03 июн, 14:20</ReadRow>
            <ReadRow label="Окончание разгрузки" mono>03 июн, 15:05</ReadRow>
            <ReadRow label="Загруженность">Полная</ReadRow>
          </PhaseBlock>
        </div>
      </Section>

      <Section title="Поля: Segmented (загруженность)">
        <Segmented
          value={load}
          onChange={setLoad}
          options={[
            { value: 'full', label: 'Полная', icon: 'check' },
            { value: 'partial', label: 'Неполная', icon: 'alert' },
          ]}
        />
      </Section>

      <Section title="ReceiptCard">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
          <ReceiptCard r={{ number: 'WH-00231', client: 'ООО «Мангуст»', sku: 5, qty: 270, status: 'partially_received' }} />
          <ReceiptCard r={{ number: 'WH-00235', client: 'ООО «СпортЛайн»', sku: 8, qty: 412, status: 'done' }} />
          <ReceiptCard r={{ number: 'WH-00238', client: 'ООО «Текстиль-Юг»', sku: 4, qty: 190, status: 'planned', eta: '03 июн' }} removable onRemove={() => {}} />
        </div>
      </Section>

      {showCosts && (
        <Section title="CostLedger (план-only / showActual)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 300px))', gap: 16 }}>
            <div className="card" style={{ padding: 14 }}>
              <div className="t-sub" style={{ marginBottom: 6, fontSize: 11 }}>до разгрузки</div>
              <CostLedger estimate={48000} />
            </div>
            <div className="card" style={{ padding: 14 }}>
              <div className="t-sub" style={{ marginBottom: 6, fontSize: 11 }}>showActual</div>
              <CostLedger estimate={48000} actual={52000} waiting={6000} showActual />
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}
