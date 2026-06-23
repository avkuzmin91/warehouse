import { useNavigate } from 'react-router-dom'
import {
  CABINET_RECEIPT_STATUS_LABELS,
  cabinetReceiptStatusTone,
  cabinetShipmentStatusLabel,
  cabinetShipmentStatusTone,
  getCabinetProfile,
  getCabinetSummary,
} from '../../../api/cabinetApi'
import type { CabinetReceiptListItem, CabinetShipmentListItem } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { fmtDate, MOSCOW_TZ } from '../../../utils/format'
import { CabinetTimeline, cabinetOpTone } from './shared/cabinetUI'

const fmt = (n: number) => n.toLocaleString('ru-RU')

function greeting(): string {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: MOSCOW_TZ }).formatToParts(new Date())
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  if (hour >= 5 && hour < 12) return 'Доброе утро 👋'
  if (hour >= 12 && hour < 18) return 'Добрый день 👋'
  return 'Добрый вечер 👋'
}

function FlowSeg({ icon, label, value, color, max, onClick }: {
  icon: IconName
  label: string
  value: number
  color: string
  max: number
  onClick: () => void
}) {
  return (
    <div className="flow-seg" style={{ flex: Math.max(max > 0 ? value / max : 0, 0.28) }} onClick={onClick}>
      <div className="flow-cap"><Icon name={icon} size={13} />{label}</div>
      <div className="flow-val">{fmt(value)}</div>
      <div className="flow-bar">
        <i style={{ width: `${Math.max(6, max > 0 ? (value / max) * 100 : 0)}%`, background: color }} />
      </div>
    </div>
  )
}

function ReceiptCard({ item, onOpen }: { item: CabinetReceiptListItem; onOpen: () => void }) {
  return (
    <div className="doc-card" onClick={onOpen}>
      <div className="doc-card-top">
        <div className="doc-card-ico in"><Icon name="dolly" size={15} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-8">
            <span className="mono" style={{ fontWeight: 550 }}>{item.doc_number}</span>
            <span className="t-sub">поступление · {item.sku_count} SKU</span>
          </div>
          <div className="t-sub dt">
            {item.status === 'planned'
              ? `ожидаем ${fmtDate(item.arrival_date)}`
              : `прибыло ${fmtDate(item.actual_arrival_date ?? item.arrival_date)}`}
          </div>
        </div>
        <Badge tone={cabinetReceiptStatusTone(item.status) as BadgeTone} dot>
          {CABINET_RECEIPT_STATUS_LABELS[item.status]}
        </Badge>
      </div>
      {item.total_accepted_qty > 0 && (
        <div className="row" style={{ gap: 10, paddingLeft: 36 }}>
          <div className="prog" style={{ width: 160 }}>
            <i className="prog-fill" style={{ width: `${item.total_planned > 0 ? Math.min(100, (item.total_accepted_qty / item.total_planned) * 100) : 0}%`, background: 'var(--c-info)', display: 'block' }} />
          </div>
          <span className="t-sub">принято {fmt(item.total_accepted_qty)} из {fmt(item.total_planned)} шт</span>
        </div>
      )}
    </div>
  )
}

function ShipmentCard({ item, onOpen }: { item: CabinetShipmentListItem; onOpen: () => void }) {
  const isDefect = item.cargo_type === 'defect'
  const shippedFull = item.total_qty > 0 && item.total_shipped_qty >= item.total_qty
  return (
    <div className="doc-card" onClick={onOpen}>
      <div className="doc-card-top">
        <div className={`doc-card-ico ${isDefect ? 'warn' : 'out'}`}>
          <Icon name={isDefect ? 'refresh' : 'boxOut'} size={15} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-8">
            <span className="mono" style={{ fontWeight: 550 }}>{item.doc_number}</span>
            <span className="t-sub">
              {isDefect ? 'возврат брака' : 'отгрузка'}
              {item.store_names.length > 0 ? ` · ${item.store_names.join(', ')}` : ''}
            </span>
          </div>
          <div className="t-sub dt">отгрузка {fmtDate(item.ship_date)}</div>
        </div>
        <Badge tone={cabinetShipmentStatusTone(item.status) as BadgeTone} dot>
          {cabinetShipmentStatusLabel(item.status, item.cargo_type)}
        </Badge>
      </div>
      <div className="row" style={{ gap: 10, paddingLeft: 36 }}>
        <div className="prog" style={{ width: 160 }}>
          <i className="prog-fill" style={{ width: `${item.total_qty > 0 ? Math.min(100, (item.total_shipped_qty / item.total_qty) * 100) : 0}%`, background: shippedFull ? 'var(--c-success)' : 'var(--c-accent)', display: 'block' }} />
        </div>
        <span className="t-sub">отгружено {fmt(item.total_shipped_qty)} из {fmt(item.total_qty)} шт</span>
      </div>
    </div>
  )
}

export function CabinetDashboardFeature() {
  const navigate = useNavigate()
  const { data, loading, error } = useApi((signal) => getCabinetSummary(signal), [])
  const profile = useApi((signal) => getCabinetProfile(signal), [])

  if (error) {
    return (
      <div className="page">
        <EmptyState title="Не удалось загрузить сводку" sub={error.message} />
      </div>
    )
  }

  const totals = data?.totals
  const receipts = data?.active_receipts ?? []
  const shipments = data?.active_shipments ?? []
  const events = data?.events ?? []
  const flowMax = Math.max(totals?.storage_good ?? 0, totals?.packing_good ?? 0, totals?.ready_good ?? 0)
  const goBalances = () => navigate('/cabinet/balances')

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="cab-hero">
        <div className="cab-hero-grid" />
        <div className="row" style={{ alignItems: 'flex-start', gap: 32, position: 'relative' }}>
          <div style={{ flex: '0 0 290px' }}>
            <div className="cab-hello">{greeting()}</div>
            <div className="cab-hero-title">{profile.data?.client.name ?? ' '}</div>
            <div style={{ marginTop: 18 }}>
              <div className="kpi-label" style={{ fontSize: 12 }}>Годного товара на складе</div>
              <div className="cab-hero-num">
                {loading ? '…' : fmt(totals?.total_good ?? 0)}<span className="unit">шт</span>
              </div>
              <div className="row gap-8 mt-12">
                <Badge tone="warning" dot>брак — {loading ? '…' : fmt(totals?.defect_total ?? 0)} шт</Badge>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 550, color: 'var(--c-text-muted)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                Где сейчас ваш товар
              </div>
              <span className="beta-hint">нажмите на зону, чтобы открыть остатки</span>
            </div>
            <div className="flow">
              <FlowSeg icon="boxes" label="Хранение" value={totals?.storage_good ?? 0} color="var(--c-accent)" max={flowMax} onClick={goBalances} />
              <div className="flow-arrow"><Icon name="chev" size={15} /></div>
              <FlowSeg icon="forklift" label="Упаковка" value={totals?.packing_good ?? 0} color="var(--c-info)" max={flowMax} onClick={goBalances} />
              <div className="flow-arrow"><Icon name="chev" size={15} /></div>
              <FlowSeg icon="check" label="Готово к отгрузке" value={totals?.ready_good ?? 0} color="var(--c-success)" max={flowMax} onClick={goBalances} />
            </div>
            <div className="row gap-16 mt-16" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>
              <span><b style={{ color: 'var(--c-text)' }}>{fmt(totals?.storage_good ?? 0)}</b> шт доступно к отгрузке прямо сейчас</span>
              <span style={{ color: 'var(--c-text-faint)' }}>·</span>
              <span><b style={{ color: 'var(--c-text)' }}>{fmt((totals?.packing_good ?? 0) + (totals?.ready_good ?? 0))}</b> шт уже в работе</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16, marginTop: 18, alignItems: 'start' }}>
        <section>
          <div className="section-head">
            <h3 className="row gap-8"><Icon name="clock" size={15} className="ic-accent" />Сейчас в работе</h3>
            <span className="t-sub">{receipts.length + shipments.length} документов</span>
          </div>
          {loading ? (
            <div className="card" style={{ padding: 16 }}><div className="t-sub">Загрузка…</div></div>
          ) : receipts.length === 0 && shipments.length === 0 ? (
            <div className="card" style={{ padding: 16 }}><div className="t-sub">Активных документов нет</div></div>
          ) : (
            <div className="col gap-8">
              {receipts.map((item) => (
                <ReceiptCard key={item.id} item={item} onOpen={() => navigate(`/cabinet/receipts/${item.id}`)} />
              ))}
              {shipments.map((item) => (
                <ShipmentCard key={item.id} item={item} onOpen={() => navigate(`/cabinet/shipments/${item.id}`)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="section-head">
            <h3 className="row gap-8"><Icon name="pulse" size={15} className="ic-accent" />Последние события</h3>
          </div>
          <div className="card" style={{ padding: '10px 16px' }}>
            {loading ? (
              <div className="t-sub">Загрузка…</div>
            ) : events.length === 0 ? (
              <div className="t-sub" style={{ padding: '6px 0' }}>Событий пока нет</div>
            ) : (
              <CabinetTimeline
                items={events.map((e) => ({
                  text: e.comment || e.op_type,
                  docNumber: e.doc_number,
                  createdAt: e.created_at,
                  tone: cabinetOpTone(e.op_type),
                  onClick: () => navigate(e.doc_kind === 'receipt' ? `/cabinet/receipts/${e.doc_id}` : `/cabinet/shipments/${e.doc_id}`),
                }))}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
