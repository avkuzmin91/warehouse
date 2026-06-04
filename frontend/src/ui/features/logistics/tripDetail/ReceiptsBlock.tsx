import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TripReceiptItem } from '../../../../api/tripsApi'
import type { ReceiptListItem } from '../../../../api/receiptsApi'
import { Icon } from '../../../primitives/Icon'
import { Badge } from '../../../primitives/Badge'
import { ReceiptCard } from '../components/ReceiptCard'
import { LinkReceiptDrawer } from './components/LinkReceiptDrawer'
import type { CreateReceiptFormValue } from './components/CreateReceiptForm'
import { Panel } from './panels'

/** SKU/шт/прибытие для привязанных поступлений (из кандидатов-«В плане», если доступны). */
export type ReceiptEnrich = Record<string, { sku?: number | null; qty?: number | null; eta?: string | null }>

export type ReceiptLink = {
  options: ReceiptListItem[]
  tripNumber: string
  tripOrigin: string | null
  onLink: (receiptIds: string[]) => Promise<void>
  onCreate?: (form: CreateReceiptFormValue) => Promise<void>
  onUnlink: (receiptDocId: string) => void
  busy?: boolean
}

/** Блок «Поступления в рейсе» (или «В машине»): ReceiptCard-список + привязка через Drawer. */
export function ReceiptsBlock({ title = 'Поступления в рейсе', right, receipts, enrich, onOpen, link, footerNote, expandable, resetKey }: {
  title?: string
  right?: ReactNode
  receipts: TripReceiptItem[]
  enrich?: ReceiptEnrich
  onOpen?: (receiptDocId: string) => void
  link?: ReceiptLink
  footerNote?: ReactNode
  /** Раскрытие строк вниз с inline-составом (требует onOpen для перехода в карточку). */
  expandable?: boolean
  /** Смена значения (id рейса) сбрасывает набор раскрытых строк. */
  resetKey?: string
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  useEffect(() => { setOpen(new Set()) }, [resetKey])

  const canExpand = !!expandable && !!onOpen
  const totalQty = receipts.reduce((s, r) => s + (enrich?.[r.receipt_doc_id]?.qty ?? 0), 0)
  const allOpen = receipts.length > 0 && open.size === receipts.length

  const toggleOne = (id: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(receipts.map((r) => r.receipt_doc_id)))

  const headerRight = right ?? (
    canExpand ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span className="t-sub">{receipts.length} поступления{totalQty > 0 ? ` · ${totalQty} шт` : ''}</span>
        {receipts.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={toggleAll}>
            <Icon name={allOpen ? 'chevUp' : 'chevDown'} size={13} />
            {allOpen ? 'Свернуть все' : 'Развернуть все'}
          </button>
        )}
      </span>
    ) : <Badge tone="accent">{receipts.length}</Badge>
  )

  return (
    <Panel icon="inbox" title={title} right={headerRight}>
      {receipts.length === 0 ? (
        <div className="t-sub" style={{ padding: '2px 0 4px' }}>Поступления ещё не привязаны</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {receipts.map((r) => {
            const e = enrich?.[r.receipt_doc_id]
            return (
              <ReceiptCard
                key={r.line_id}
                r={{
                  receipt_doc_id: r.receipt_doc_id,
                  number: r.receipt_number,
                  client: r.client_name,
                  status: r.receipt_status,
                  sku: e?.sku,
                  qty: e?.qty,
                  eta: e?.eta,
                }}
                expandable={canExpand}
                expanded={open.has(r.receipt_doc_id)}
                onToggle={() => toggleOne(r.receipt_doc_id)}
                onOpen={onOpen ? () => onOpen(r.receipt_doc_id) : undefined}
                onClick={onOpen ? () => onOpen(r.receipt_doc_id) : undefined}
                removable={!!link}
                onRemove={link ? () => link.onUnlink(r.receipt_doc_id) : undefined}
              />
            )
          })}
        </div>
      )}

      {canExpand && receipts.length > 0 && (
        <div className="row gap-8" style={{ alignItems: 'center', marginTop: 10, fontSize: 11.5, color: 'var(--c-text-faint)' }}>
          <Icon name="alert" size={13} style={{ flexShrink: 0 }} />
          <span>Стрелка → открывает полную карточку поступления</span>
        </div>
      )}

      {link && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
            marginTop: receipts.length ? 10 : 6, padding: '12px',
            border: '1px dashed var(--c-border-strong)', borderRadius: 'var(--r-md)',
            background: 'transparent', cursor: 'pointer', color: 'var(--c-text-muted)', fontSize: 12.5, fontFamily: 'inherit',
          }}
          onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--c-bg-hover)' }}
          onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent' }}
        >
          <Icon name="plus" size={13} />
          Привязать поступление
          {link.onCreate && <span style={{ color: 'var(--c-text-subtle)' }}>· или создать новое прямо в рейсе</span>}
        </button>
      )}

      {footerNote && <div style={{ marginTop: 12 }}>{footerNote}</div>}

      {link && (
        <LinkReceiptDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          tripNumber={link.tripNumber}
          tripOrigin={link.tripOrigin}
          candidates={link.options}
          busy={link.busy}
          onLink={link.onLink}
          onCreate={link.onCreate}
        />
      )}
    </Panel>
  )
}
