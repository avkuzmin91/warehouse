import { useState } from 'react'
import { getReceipt } from '../../../../api/receiptsApi'
import type { ReceiptLine } from '../../../../api/receiptsApi'
import { useApi } from '../../../../hooks/useApi'
import { Icon } from '../../../primitives/Icon'
import { Badge } from '../../../primitives/Badge'
import type { BadgeTone } from '../../../primitives/Badge'
import { ReceiptLinesTable } from './ReceiptLinesTable'

export type ExpandableReceiptData = {
  receipt_doc_id: string
  number: string | null
  client: string | null
  status?: string | null
}

const STATUS_RU: Record<string, string> = {
  planned: 'В плане', on_intake: 'Принят', on_review: 'На проверке', done: 'Поступил',
}
const STATUS_TONE: Record<string, BadgeTone> = {
  planned: '', on_intake: 'info', on_review: 'warning', done: 'success',
}

function LinesBody({ docId }: { docId: string }) {
  const [retry, setRetry] = useState(0)
  const { data, loading, error } = useApi(() => getReceipt(docId), [docId, retry])
  const lines: ReceiptLine[] = data?.lines ?? []
  return <ReceiptLinesTable lines={lines} loading={loading} error={!!error} onRetry={() => setRetry((n) => n + 1)} />
}

/** Раскрываемая строка-поступление в карточке рейса: шапка-тоггл + inline-состав + переход в карточку. */
export function ExpandableReceiptRow({ r, open, onToggle, onOpen, onRemove }: {
  r: ExpandableReceiptData
  open: boolean
  onToggle: () => void
  onOpen: () => void
  onRemove?: () => void
}) {
  // Состав грузим лениво: монтируем тело только после первого раскрытия.
  const [everOpened, setEverOpened] = useState(open)
  if (open && !everOpened) setEverOpened(true)

  return (
    <div
      className="exp-row card"
      style={{ padding: 0, overflow: 'hidden', borderColor: open ? 'var(--c-border-strong)' : undefined }}
    >
      <div
        className="row gap-8"
        style={{ alignItems: 'center', background: open ? 'var(--c-bg-sunken)' : undefined }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12,
            padding: '9px 11px', background: 'transparent', border: 'none', cursor: 'pointer',
            font: 'inherit', textAlign: 'left', color: 'inherit',
          }}
        >
          <Icon name="chev" size={15} aria-hidden className={`exp-chev${open ? ' open' : ''}`} style={{ flexShrink: 0, color: 'var(--c-text-subtle)' }} />
          <div style={{
            width: 30, height: 30, borderRadius: 7, background: 'var(--c-bg-elev)', flexShrink: 0,
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
          </div>
        </button>

        {r.status && (
          <Badge tone={STATUS_TONE[r.status] ?? ''} dot>{STATUS_RU[r.status] ?? r.status}</Badge>
        )}
        <button
          type="button"
          className="btn ghost icon sm exp-open-btn"
          title="Открыть карточку поступления"
          onClick={(e) => { e.stopPropagation(); onOpen() }}
          style={{ marginRight: onRemove ? 0 : 8 }}
        >
          <Icon name="arrowRight" size={14} />
        </button>
        {onRemove && (
          <button
            type="button"
            className="btn ghost icon sm"
            title="Отвязать"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            style={{ marginRight: 8 }}
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      <div className={`exp-wrap${open ? ' open' : ''}`}>
        <div className="exp-inner">
          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--c-border)' }}>
            {everOpened && <LinesBody docId={r.receipt_doc_id} />}

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
              marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--c-border)',
            }}>
              <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>Нужны реквизиты, приёмка, брак?</span>
              <button type="button" className="btn sm" onClick={onOpen}>
                <Icon name="inbox" size={13} />
                Открыть карточку поступления
                <Icon name="arrowRight" size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
