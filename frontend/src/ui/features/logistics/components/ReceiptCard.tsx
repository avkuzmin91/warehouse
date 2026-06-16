import { Icon } from '../../../primitives/Icon'
import { Badge } from '../../../primitives/Badge'
import type { BadgeTone } from '../../../primitives/Badge'
import { ExpandableReceiptRow } from './ExpandableReceiptRow'
import type { TripReceiptAlloc } from '../../../../api/tripsApi'

export type ReceiptCardData = {
  receipt_doc_id?: string
  number: string | null
  client: string | null
  /** SKU/шт известны только для кандидатов на привязку; у привязанных строк рейса их нет. */
  sku?: number | null
  qty?: number | null
  status?: string | null
  eta?: string | null
  /** Сколько привёз этот рейс (распределение по строкам). */
  allocatedQty?: number
  allocations?: TripReceiptAlloc[]
}

const STATUS_RU: Record<string, string> = {
  planned: 'В плане', on_intake: 'Принят', partially_received: 'Частично принято',
  on_review: 'На проверке', done: 'Поступил',
}
const STATUS_TONE: Record<string, BadgeTone> = {
  planned: '', on_intake: 'info', partially_received: 'warning', on_review: 'warning', done: 'success',
}

/** Карточка привязанного поступления: клиент, номер (mono), SKU/шт, бейдж статуса. */
export function ReceiptCard({ r, removable, onRemove, onClick, expandable, expanded, onToggle, onOpen }: {
  r: ReceiptCardData
  removable?: boolean
  onRemove?: () => void
  onClick?: () => void
  /** Раскрытие строки вниз с inline-составом поступления (в карточке рейса). */
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
  onOpen?: () => void
}) {
  if (expandable && r.receipt_doc_id) {
    return (
      <ExpandableReceiptRow
        r={{
          receipt_doc_id: r.receipt_doc_id, number: r.number, client: r.client, status: r.status,
          allocated_qty: r.allocatedQty, allocations: r.allocations,
        }}
        open={!!expanded}
        onToggle={onToggle ?? (() => {})}
        onOpen={onOpen ?? onClick ?? (() => {})}
        onRemove={removable ? onRemove : undefined}
      />
    )
  }

  return (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px', cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      <div style={{
        width: 30, height: 30, borderRadius: 7, background: 'var(--c-bg-sunken)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-subtle)',
      }}>
        <Icon name="inbox" size={15} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {r.client ?? 'Без клиента'}
          </span>
          {r.number && <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', flexShrink: 0 }}>{r.number}</span>}
        </div>
        {(r.sku != null || r.qty != null || r.eta || (r.allocatedQty ?? 0) > 0) && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>
            {[
              r.sku != null ? `${r.sku} SKU` : null,
              (r.allocatedQty ?? 0) > 0 ? `${r.allocatedQty} шт в рейсе` : (r.qty != null ? `${r.qty} шт` : null),
              r.eta ? `прибытие ${r.eta}` : null,
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      {r.status && <Badge tone={STATUS_TONE[r.status] ?? ''} dot>{STATUS_RU[r.status] ?? r.status}</Badge>}
      {removable && (
        <button
          type="button"
          className="btn ghost icon sm"
          title="Отвязать"
          onClick={(e) => { e.stopPropagation(); onRemove?.() }}
        >
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  )
}
