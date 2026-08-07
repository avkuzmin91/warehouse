import { Link } from 'react-router-dom'
import {
  getStockHistory,
  STOCK_EVENT_LABELS,
  WRITEOFF_REASON_LABELS,
  INV_QUALITY_LABELS,
} from '../../../../api/balancesApi'
import type { StockHistoryEvent, TurnoverItem, WriteOffReason } from '../../../../api/balancesApi'
import { useApi } from '../../../../hooks/useApi'
import { Drawer } from '../../../feedback/Drawer'
import { Icon } from '../../../primitives/Icon'
import { EmptyState } from '../../../primitives/EmptyState'
import { MOSCOW_TZ, parseMoscow } from '../../../../utils/format'

const num = (n: number) => n.toLocaleString('ru-RU')

function fmtDateTime(iso: string): string {
  const d = parseMoscow(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: MOSCOW_TZ })
}

/** Документ-источник события: поступление, отгрузка или рейс. */
function EventDoc({ e }: { e: StockHistoryEvent }) {
  if (e.receipt_id && e.receipt_number) {
    return <Link to={`/inventory/receipts/${e.receipt_id}`} className="mono">{e.receipt_number}</Link>
  }
  if (e.dispatch_id && e.dispatch_number) {
    return <Link to={`/inventory/dispatches/${e.dispatch_id}`} className="mono">{e.dispatch_number}</Link>
  }
  if (e.trip_id && e.trip_number) {
    return <Link to={`/logistics/trips/${e.trip_id}`} className="mono">{e.trip_number}</Link>
  }
  return <span className="t-sub">Без документа</span>
}

function EventRow({ e }: { e: StockHistoryEvent }) {
  const positive = e.delta > 0
  const reason = e.reason ? WRITEOFF_REASON_LABELS[e.reason as WriteOffReason] : undefined
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--c-border)' }}>
      <div
        style={{
          width: 26, height: 26, flexShrink: 0, borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: positive ? 'var(--c-success-bg)' : 'var(--c-warning-bg)',
          color: positive ? 'var(--c-success)' : 'var(--c-warning)',
        }}
      >
        <Icon name={positive ? 'arrowDown' : 'arrowUp'} size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13.5 }}>
            {STOCK_EVENT_LABELS[e.kind] ?? e.kind}
            {reason && <span className="t-sub"> · {reason}</span>}
          </span>
          <span
            className="num"
            style={{ fontWeight: 600, whiteSpace: 'nowrap', color: positive ? 'var(--c-success)' : 'var(--c-warning)' }}
          >
            {positive ? '+' : '−'}{num(Math.abs(e.delta))}
          </span>
        </div>
        <div className="t-sub" style={{ fontSize: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span>{fmtDateTime(e.created_at)}</span>
          <span>·</span>
          <EventDoc e={e} />
          {e.quality === 'defect' && (
            <>
              <span>·</span>
              <span style={{ color: 'var(--c-warning)' }}>{INV_QUALITY_LABELS.defect}</span>
            </>
          )}
          {e.zone_name && (<><span>·</span><span>{e.zone_name}</span></>)}
        </div>
        {e.comment && (
          <div className="t-sub" style={{ fontSize: 12, marginTop: 2, color: 'var(--c-text-muted)' }}>{e.comment}</div>
        )}
        <div className="t-sub" style={{ fontSize: 11.5, marginTop: 2 }}>
          Остаток после: <span className="num" style={{ fontWeight: 600, color: 'var(--c-text)' }}>{num(e.balance_after)}</span>
          {e.created_by_email && <> · {e.created_by_email}</>}
        </div>
      </div>
    </div>
  )
}

interface Props {
  item: TurnoverItem | null
  dateFrom?: string
  dateTo?: string
  onClose: () => void
}

/** Хронология значимых событий позиции: как остаток пришёл к текущему значению. */
export function PositionHistoryDrawer({ item, dateFrom, dateTo, onClose }: Props) {
  const { data, loading, error } = useApi(
    (signal) => (item
      ? getStockHistory({
        product_id: item.product_id,
        client_id: item.client_id,
        color_id: item.color_id,
        size_id: item.size_id,
        date_from: dateFrom,
        date_to: dateTo,
      }, signal)
      : Promise.resolve(null)),
    [item?.product_id, item?.client_id, item?.color_id, item?.size_id, dateFrom, dateTo],
  )

  if (!item) return null

  const subtitle = [item.product_sku, item.color_name, item.size_name, item.client_name]
    .filter(Boolean)
    .join(' · ')

  return (
    <Drawer
      open
      onClose={onClose}
      title={item.product_name ?? 'Позиция'}
      subtitle={subtitle}
      width={560}
      closeOnBackdrop
    >
      {loading ? (
        <div className="t-sub" style={{ padding: 12 }}>Загрузка…</div>
      ) : error ? (
        <div style={{ padding: 12, color: 'var(--c-danger)' }}>Не удалось загрузить историю</div>
      ) : !data || data.events.length === 0 ? (
        <EmptyState title="Событий нет" sub="По этой позиции нет прихода, отгрузок и списаний" />
      ) : (
        <>
          <div
            className="card"
            style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', marginBottom: 12 }}
          >
            <div>
              <div className="t-sub" style={{ fontSize: 12 }}>Остаток до первого события</div>
              <div className="num" style={{ fontWeight: 600 }}>{num(data.opening)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="t-sub" style={{ fontSize: 12 }}>Текущий остаток</div>
              <div className="num" style={{ fontWeight: 700 }}>{num(data.closing)}</div>
            </div>
          </div>

          {data.truncated && (
            <div className="t-sub" style={{ fontSize: 12, marginBottom: 8 }}>
              Показаны последние {data.events.length} из {num(data.total_events)} событий
            </div>
          )}

          {data.events.map((e) => <EventRow key={e.id} e={e} />)}
        </>
      )}
    </Drawer>
  )
}
