import { useState } from 'react'
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
  onCreate: (form: CreateReceiptFormValue) => Promise<void>
  onUnlink: (receiptDocId: string) => void
  busy?: boolean
}

/** Блок «Поступления в рейсе» (или «В машине»): ReceiptCard-список + привязка через Drawer. */
export function ReceiptsBlock({ title = 'Поступления в рейсе', right, receipts, enrich, onOpen, link, footerNote }: {
  title?: string
  right?: ReactNode
  receipts: TripReceiptItem[]
  enrich?: ReceiptEnrich
  onOpen?: (receiptDocId: string) => void
  link?: ReceiptLink
  footerNote?: ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <Panel icon="inbox" title={title} right={right ?? <Badge tone="accent">{receipts.length}</Badge>}>
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
                onClick={onOpen ? () => onOpen(r.receipt_doc_id) : undefined}
                removable={!!link}
                onRemove={link ? () => link.onUnlink(r.receipt_doc_id) : undefined}
              />
            )
          })}
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
          Привязать поступление · <span style={{ color: 'var(--c-text-subtle)' }}>или создать новое прямо в рейсе</span>
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
