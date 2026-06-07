import { useNavigate } from 'react-router-dom'
import { getOperationalPlan } from '../../../api/dashboardApi'
import type { OperationalPlanItem } from '../../../api/dashboardApi'
import {
  RECEIPT_STATUS_LABELS,
  receiptStatusTone,
  type ReceiptStatus,
} from '../../../api/receiptsApi'
import {
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
  type ShipmentStatus,
} from '../../../api/shipmentsApi'
import { useApi } from '../../../hooks/useApi'
import { Badge, type BadgeTone } from '../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../primitives/Card'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'

const PRIORITY_TONE: Record<OperationalPlanItem['priority'], BadgeTone> = {
  overdue: 'danger',
  today: 'warning',
  active: 'info',
  upcoming: '',
  no_date: 'warning',
}

const PRIORITY_LABEL: Record<OperationalPlanItem['priority'], string> = {
  overdue: 'Просрочено',
  today: 'Сегодня',
  active: 'В работе',
  upcoming: 'В плане',
  no_date: 'Без даты',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmtDate(value: string | null): string {
  if (!value) return 'без даты'
  if (value === todayIso()) return 'сегодня'
  if (value === addDaysIso(1)) return 'завтра'
  return new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

function itemPath(item: OperationalPlanItem): string {
  if (item.type === 'receipt') return `/inventory/receipts/${item.id}`
  return `/inventory/shipments/${item.id}`
}

function itemTitle(item: OperationalPlanItem): string {
  return item.client_name || item.destination || 'Клиент не указан'
}

function statusLabel(item: OperationalPlanItem): string {
  if (item.type === 'receipt') {
    return RECEIPT_STATUS_LABELS[item.status as ReceiptStatus] ?? item.status
  }
  return SHIPMENT_STATUS_LABELS[item.status as ShipmentStatus] ?? item.status
}

function statusTone(item: OperationalPlanItem): BadgeTone {
  if (item.type === 'receipt') {
    return receiptStatusTone(item.status as ReceiptStatus) as BadgeTone
  }
  return (SHIPMENT_STATUS_TONES[item.status as ShipmentStatus] ?? '') as BadgeTone
}

function progressLabel(item: OperationalPlanItem): string {
  const progress = item.progress_qty ?? 0
  const noun = item.type === 'receipt' ? 'принято' : 'упаковано'
  return `${noun}: ${progress.toLocaleString('ru-RU')} / ${item.total_qty.toLocaleString('ru-RU')}`
}

function PlanRow({ item }: { item: OperationalPlanItem }) {
  const navigate = useNavigate()

  return (
    <button
      type="button"
      onClick={() => navigate(itemPath(item))}
      style={{
        width: '100%',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '8px 10px',
        border: 0,
        borderTop: '1px solid var(--c-border)',
        background: 'transparent',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{item.doc_number}</span>
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            {itemTitle(item)}
          </span>
        </span>
        <span className="t-sub" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 12, minWidth: 0 }}>
          <Icon name="calendar" size={12} />
          {fmtDate(item.date)}
          <span>·</span>
          <span>{item.sku_count} SKU</span>
          <span>·</span>
          <span>{item.total_qty.toLocaleString('ru-RU')} шт</span>
          <span>·</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{progressLabel(item)}</span>
        </span>
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <Badge tone={statusTone(item)}>{statusLabel(item)}</Badge>
        <Badge tone={PRIORITY_TONE[item.priority]}>{PRIORITY_LABEL[item.priority]}</Badge>
      </span>
    </button>
  )
}

function PlanColumn({
  title,
  icon,
  items,
  empty,
}: {
  title: string
  icon: IconName
  items: OperationalPlanItem[]
  empty: string
}) {
  return (
    <div style={{ minWidth: 0, border: '1px solid var(--c-border)', borderRadius: 7, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--c-bg-sunken)' }}>
        <Icon name={icon} size={15} style={{ color: 'var(--c-accent)' }} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-subtle)' }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="t-sub" style={{ padding: 14, fontSize: 13 }}>{empty}</div>
      ) : (
        items.map((item) => (
          <PlanRow key={`${item.type}-${item.id}`} item={item} />
        ))
      )}
    </div>
  )
}

export function OperationalPlanFeature() {
  const { data, loading, error } = useApi((signal) => getOperationalPlan({ limit: 4, horizon_days: 7 }, signal), [])

  return (
    <Card>
      <CardHead>
        <Icon name="calendar" size={15} style={{ color: 'var(--c-accent)' }} />
        <div className="card-head-title">Операционный план</div>
        {!loading && data && (
          <div className="right row gap-8">
            <Badge tone="info">{data.totals.receipts} поступл.</Badge>
            <Badge tone="info">{data.totals.shipments} отгр.</Badge>
            {data.totals.overdue > 0 && <Badge tone="danger" dot>{data.totals.overdue} просрочено</Badge>}
          </div>
        )}
      </CardHead>
      <CardBody style={{ padding: 12 }}>
        {loading ? (
          <div className="t-sub" style={{ padding: 6 }}>Загрузка…</div>
        ) : error ? (
          <div className="t-sub" style={{ padding: 6 }}>Не удалось загрузить операционный план</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <PlanColumn
              title="Поступления"
              icon="truckIn"
              items={data?.receipts ?? []}
              empty="Нет поступлений в ближайшем плане"
            />
            <PlanColumn
              title="Отгрузки"
              icon="boxOut"
              items={data?.shipments ?? []}
              empty="Нет отгрузок в ближайшем плане"
            />
          </div>
        )}
      </CardBody>
    </Card>
  )
}
