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

const PLAN_PREVIEW_LIMIT = 3

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
          {item.type === 'shipment' && item.priority_rank && (
            <Badge tone="warning">#{item.priority_rank}</Badge>
          )}
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
          <span>{item.total_qty.toLocaleString('ru-RU')} шт</span>
        </span>
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <Badge tone={statusTone(item)}>{statusLabel(item)}</Badge>
      </span>
    </button>
  )
}

function PlanColumn({
  title,
  icon,
  items,
  total,
  empty,
  morePath,
}: {
  title: string
  icon: IconName
  items: OperationalPlanItem[]
  total: number
  empty: string
  morePath: string
}) {
  const navigate = useNavigate()
  const remaining = Math.max(total - items.length, 0)

  return (
    <div style={{ minWidth: 0, border: '1px solid var(--c-border)', borderRadius: 7, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--c-bg-sunken)' }}>
        <Icon name={icon} size={15} style={{ color: 'var(--c-accent)' }} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-subtle)' }}>
          {items.length}/{total}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="t-sub" style={{ padding: 14, fontSize: 13 }}>{empty}</div>
      ) : (
        items.map((item) => (
          <PlanRow key={`${item.type}-${item.id}`} item={item} />
        ))
      )}
      {remaining > 0 && (
        <div style={{ padding: 8, borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)' }}>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => navigate(morePath)}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Ещё {remaining} в плане
          </button>
        </div>
      )}
    </div>
  )
}

export function OperationalPlanFeature() {
  const { data, loading, error } = useApi(
    (signal) => getOperationalPlan({ receipts_limit: PLAN_PREVIEW_LIMIT, shipments_limit: PLAN_PREVIEW_LIMIT }, signal),
    [],
  )

  return (
    <Card>
      <CardHead>
        <Icon name="calendar" size={15} style={{ color: 'var(--c-accent)' }} />
        <div className="card-head-title">Операционный план</div>
        {data && (
          <div className="right row gap-8">
            <Badge tone="info">{data.totals.receipts} поступл.</Badge>
            <Badge tone="info">{data.totals.shipments} отгр.</Badge>
          </div>
        )}
      </CardHead>
      <CardBody style={{ padding: 12 }}>
        {loading && !data ? (
          <div className="t-sub" style={{ padding: 6 }}>Загрузка…</div>
        ) : error && !data ? (
          <div className="t-sub" style={{ padding: 6 }}>Не удалось загрузить операционный план</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
            <PlanColumn
              title="Отгрузки"
              icon="boxOut"
              items={data?.shipments ?? []}
              total={data?.totals.shipments ?? 0}
              empty="Нет отгрузок на сегодня и ранее"
              morePath="/inventory/shipments"
            />
            <PlanColumn
              title="Поступления"
              icon="truckIn"
              items={data?.receipts ?? []}
              total={data?.totals.receipts ?? 0}
              empty="Нет поступлений на сегодня и ранее"
              morePath="/inventory/receipts"
            />
          </div>
        )}
      </CardBody>
    </Card>
  )
}
