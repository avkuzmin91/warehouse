import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TripReceiptItem, TripReceiptLinkItem } from '../../../../api/tripsApi'
import { RECEIPT_STATUS_LABELS, receiptStatusTone, getReceiptTripRemaining } from '../../../../api/receiptsApi'
import type { ReceiptListItem, ReceiptStatus } from '../../../../api/receiptsApi'
import { Icon } from '../../../primitives/Icon'
import { Badge } from '../../../primitives/Badge'
import { ReceiptCard } from '../components/ReceiptCard'
import { AllocModal } from './components/AllocModal'
import type { AllocDoc, AllocLine, AllocItem } from './components/AllocModal'
import type { CreateReceiptFormValue } from './components/CreateReceiptForm'
import { Panel } from './panels'

/** SKU/шт/прибытие для привязанных поступлений (из кандидатов-«В плане», если доступны). */
export type ReceiptEnrich = Record<string, { sku?: number | null; qty?: number | null; eta?: string | null }>

export type ReceiptLink = {
  options: ReceiptListItem[]
  tripNumber: string
  tripOrigin: string | null
  onLink: (items: TripReceiptLinkItem[]) => Promise<void>
  onCreate?: (form: CreateReceiptFormValue) => Promise<void>
  onUnlink: (receiptDocId: string) => void
  /** Сохранение распределения из модала: привязка/замена + отвязка убранных. */
  onSaveDistribution: (items: TripReceiptLinkItem[], removedDocIds: string[]) => Promise<void>
  /** Пресеты-аллокации уже учтены в trip_alloc (карточка рейса) → их прибавляем к остатку.
   *  В создании рейса (false) распределение локальное, рейса ещё нет — не прибавляем. */
  presetsLinked?: boolean
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
  // В рейсе показываем распределённое количество (allocated_qty); для легаси-привязок — план из enrich.
  const totalQty = receipts.reduce((s, r) => s + (r.allocated_qty || (enrich?.[r.receipt_doc_id]?.qty ?? 0)), 0)
  const receivedTotal = receipts.reduce((s, r) => s + (r.received_qty ?? 0), 0)
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
        <span className="t-sub">
          {receipts.length} поступления{totalQty > 0 ? ` · план ${totalQty} шт` : ''}
          {totalQty > 0 ? ` · принято ${receivedTotal}` : ''}
        </span>
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
                  allocatedQty: r.allocated_qty,
                  allocations: r.allocations,
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

      {link && drawerOpen && (
        <AllocModal
          open
          onClose={() => setDrawerOpen(false)}
          tripNumber={link.tripNumber}
          tripDestination={link.tripOrigin}
          lex={{ headerIcon: 'inbox', docsGen: 'поступления', addTitle: 'Поступления', flowLabel: 'Прибывает рейсом', dateLabel: 'Плановое прибытие' }}
          linkedDocs={receipts.map((r): AllocDoc => ({
            doc_id: r.receipt_doc_id,
            client: r.client_name,
            doc_number: r.receipt_number,
            status_label: RECEIPT_STATUS_LABELS[(r.receipt_status ?? '') as ReceiptStatus] ?? (r.receipt_status ?? ''),
            status_tone: receiptStatusTone((r.receipt_status ?? '') as ReceiptStatus),
          }))}
          candidates={link.options.map((c): AllocDoc => ({
            doc_id: c.id,
            client: c.client_name,
            doc_number: c.doc_number,
            status_label: RECEIPT_STATUS_LABELS[c.status] ?? c.status,
            status_tone: receiptStatusTone(c.status),
            date: c.arrival_date ?? null,
            sub: `${c.sku_count} SKU · ${c.total_planned} шт`,
          }))}
          fetchLines={async (docId): Promise<AllocLine[]> => {
            const presets = receipts.find((r) => r.receipt_doc_id === docId)?.allocations
            const presetMap: Record<string, number> | null = presets && presets.length > 0
              ? Object.fromEntries(presets.map((a) => [a.line_id, a.qty]))
              : null
            const res = await getReceiptTripRemaining(docId)
            return res.lines.map((l): AllocLine => {
              const preset = presetMap ? (presetMap[l.line_id] ?? 0) : null
              const addBack = link.presetsLinked === false ? 0 : (preset ?? 0)
              return {
                line_id: l.line_id,
                sku: l.product_sku,
                name: l.product_name,
                variant: l.variant,
                color: l.color,
                plan: l.planned_qty,
                max: l.remaining + addBack,
                preset,
                allocations: l.allocations?.filter((a) => a.trip_number !== link.tripNumber),
              }
            })
          }}
          onConfirm={async (items: AllocItem[], removed) => {
            await link.onSaveDistribution(
              items.map((it) => ({ receipt_doc_id: it.doc_id, allocations: it.allocations })),
              removed,
            )
          }}
          busy={link.busy}
        />
      )}
    </Panel>
  )
}
