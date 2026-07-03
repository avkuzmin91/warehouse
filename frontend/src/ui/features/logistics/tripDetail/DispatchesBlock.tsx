import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TripDispatchItem, TripDispatchLinkItem } from '../../../../api/tripsApi'
import { DISPATCH_STATUS_LABELS, DISPATCH_STATUS_TONES, getDispatchTripRemaining } from '../../../../api/dispatchApi'
import type { DispatchListItem, DispatchStatus } from '../../../../api/dispatchApi'
import { Icon } from '../../../primitives/Icon'
import { Badge } from '../../../primitives/Badge'
import { ExpandableDispatchRow } from '../components/ExpandableDispatchRow'
import { Panel } from './panels'
import { AllocModal } from './components/AllocModal'
import type { AllocDoc, AllocLine, AllocItem } from './components/AllocModal'

/** SKU/шт для привязанных отгрузок (из кандидатов, если доступны). */
export type DispatchEnrich = Record<string, { sku?: number | null; qty?: number | null }>

export type DispatchLink = {
  options: DispatchListItem[]
  tripNumber: string
  tripDestination: string | null
  onLink: (items: TripDispatchLinkItem[]) => Promise<void>
  onUnlink: (dispatchDocId: string) => void
  /** Сохранение распределения из модала: привязка/замена + отвязка убранных. */
  onSaveDistribution: (items: TripDispatchLinkItem[], removedDocIds: string[]) => Promise<void>
  /** Серверный поиск кандидатов по всему пулу (предзагруженных `options` мало — лимит 100). */
  searchCandidates?: (query: string, signal: AbortSignal) => Promise<DispatchListItem[]>
  /** Пресеты-аллокации уже учтены в trip_alloc (карточка рейса) → их прибавляем к остатку.
   *  В создании рейса (false) распределение локальное, рейса ещё нет — не прибавляем. */
  presetsLinked?: boolean
  busy?: boolean
}

/** Кандидат-отгрузка → строка пикера AllocModal. */
function toCandidate(c: DispatchListItem): AllocDoc {
  return {
    doc_id: c.id,
    client: c.client_name,
    doc_number: c.doc_number,
    status_label: DISPATCH_STATUS_LABELS[c.status] ?? c.status,
    status_tone: DISPATCH_STATUS_TONES[c.status] ?? '',
    date: c.ship_date ?? null,
    sub: `${c.sku_count} SKU · ${c.total_qty} шт`,
  }
}

/** Блок «Отгрузки в рейсе» — зеркало ReceiptsBlock: карточки отгрузок + привязка через Drawer. */
export function DispatchesBlock({ title = 'Отгрузки в рейсе', right, dispatches, enrich, onOpen, link, onUnlink, footerNote, expandable, resetKey }: {
  title?: string
  right?: ReactNode
  dispatches: TripDispatchItem[]
  enrich?: DispatchEnrich
  onOpen?: (dispatchDocId: string) => void
  link?: DispatchLink
  /** Открепление без блока привязки (рейс уже в погрузке). Игнорируется, если задан link. */
  onUnlink?: (dispatchDocId: string) => void
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
  const unlink = link?.onUnlink ?? onUnlink
  // В рейсе показываем распределённое количество (allocated_qty); для легаси-привязок
  // без распределения — падаем на полный план из enrich.
  const totalQty = dispatches.reduce((s, d) => s + (d.allocated_qty || (enrich?.[d.dispatch_doc_id]?.qty ?? 0)), 0)
  const allOpen = dispatches.length > 0 && open.size === dispatches.length

  const toggleOne = (id: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(dispatches.map((d) => d.dispatch_doc_id)))

  const headerRight = right ?? (
    canExpand ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span className="t-sub">{dispatches.length} отгрузки{totalQty > 0 ? ` · ${totalQty} шт` : ''}</span>
        {dispatches.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={toggleAll}>
            <Icon name={allOpen ? 'chevUp' : 'chevDown'} size={13} />
            {allOpen ? 'Свернуть все' : 'Развернуть все'}
          </button>
        )}
      </span>
    ) : <Badge tone="accent">{dispatches.length}</Badge>
  )

  return (
    <Panel icon="boxOut" title={title} right={headerRight}>
      {dispatches.length === 0 ? (
        <div className="t-sub" style={{ padding: '2px 0 4px' }}>Отгрузки ещё не привязаны</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dispatches.map((d) => {
            if (canExpand) {
              return (
                <ExpandableDispatchRow
                  key={d.line_id}
                  r={{
                    dispatch_doc_id: d.dispatch_doc_id,
                    dispatch_number: d.dispatch_number ?? null,
                    client_name: d.client_name ?? null,
                    dispatch_status: d.dispatch_status,
                    allocated_qty: d.allocated_qty,
                    allocations: d.allocations,
                  }}
                  open={open.has(d.dispatch_doc_id)}
                  onToggle={() => toggleOne(d.dispatch_doc_id)}
                  onOpen={() => onOpen!(d.dispatch_doc_id)}
                  onRemove={unlink ? () => unlink(d.dispatch_doc_id) : undefined}
                />
              )
            }
            // Обычная (не раскрываемая) карточка
            const e = enrich?.[d.dispatch_doc_id]
            return (
              <DispatchCardSimple
                key={d.line_id}
                d={d}
                enrich={e}
                onOpen={onOpen ? () => onOpen(d.dispatch_doc_id) : undefined}
                onRemove={unlink ? () => unlink(d.dispatch_doc_id) : undefined}
              />
            )
          })}
        </div>
      )}

      {canExpand && dispatches.length > 0 && (
        <div className="row gap-8" style={{ alignItems: 'center', marginTop: 10, fontSize: 11.5, color: 'var(--c-text-faint)' }}>
          <Icon name="alert" size={13} style={{ flexShrink: 0 }} />
          <span>Стрелка → открывает полную карточку отгрузки</span>
        </div>
      )}

      {link && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%',
            marginTop: dispatches.length ? 10 : 6, padding: '12px',
            border: '1px dashed var(--c-border-strong)', borderRadius: 'var(--r-md)',
            background: 'transparent', cursor: 'pointer', color: 'var(--c-text-muted)', fontSize: 12.5, fontFamily: 'inherit',
          }}
          onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--c-bg-hover)' }}
          onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent' }}
        >
          <Icon name="plus" size={13} />Привязать отгрузку
        </button>
      )}

      {footerNote && <div style={{ marginTop: 12 }}>{footerNote}</div>}

      {link && drawerOpen && (
        <AllocModal
          open
          onClose={() => setDrawerOpen(false)}
          tripNumber={link.tripNumber}
          tripDestination={link.tripDestination}
          lex={{ headerIcon: 'boxOut', docsGen: 'отгрузки', addTitle: 'Отгрузки', flowLabel: 'Уходит в рейс', dateLabel: 'Плановая отгрузка' }}
          linkedDocs={dispatches.map((d): AllocDoc => ({
            doc_id: d.dispatch_doc_id,
            client: d.client_name,
            doc_number: d.dispatch_number,
            status_label: DISPATCH_STATUS_LABELS[(d.dispatch_status ?? '') as DispatchStatus] ?? (d.dispatch_status ?? ''),
            status_tone: DISPATCH_STATUS_TONES[(d.dispatch_status ?? '') as DispatchStatus] ?? '',
          }))}
          candidates={link.options.map(toCandidate)}
          searchCandidates={link.searchCandidates
            ? async (q, signal) => (await link.searchCandidates!(q, signal)).map(toCandidate)
            : undefined}
          fetchLines={async (docId): Promise<AllocLine[]> => {
            const presets = dispatches.find((d) => d.dispatch_doc_id === docId)?.allocations
            const presetMap: Record<string, number> | null = presets && presets.length > 0
              ? Object.fromEntries(presets.map((a) => [a.line_id, a.qty]))
              : null
            const res = await getDispatchTripRemaining(docId)
            return res.lines.map((l): AllocLine => {
              const preset = presetMap ? (presetMap[l.line_id] ?? 0) : null
              const addBack = link.presetsLinked === false ? 0 : (preset ?? 0)
              return {
                line_id: l.line_id,
                sku: l.product_sku,
                name: l.product_name,
                variant: l.variant,
                color: l.color,
                plan: l.qty,
                max: l.remaining + addBack,
                preset,
                allocations: l.allocations?.filter((a) => a.trip_number !== link.tripNumber),
                shipped: l.qty > 0 && l.shipped_qty >= l.qty,
              }
            })
          }}
          onConfirm={async (items: AllocItem[], removed) => {
            await link.onSaveDistribution(
              items.map((it) => ({ dispatch_doc_id: it.doc_id, allocations: it.allocations })),
              removed,
            )
          }}
          busy={link.busy}
        />
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Простая (не раскрываемая) карточка — используется когда expandable не задан

import type { BadgeTone } from '../../../primitives/Badge'

function DispatchCardSimple({ d, enrich, onOpen, onRemove }: {
  d: TripDispatchItem
  enrich?: { sku?: number | null; qty?: number | null }
  onOpen?: () => void
  onRemove?: () => void
}) {
  const status = (d.dispatch_status ?? '') as DispatchStatus
  return (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px', cursor: onOpen ? 'pointer' : 'default' }}
      onClick={onOpen}
    >
      <div style={{
        width: 30, height: 30, borderRadius: 7, background: 'var(--c-bg-sunken)', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-subtle)',
      }}>
        <Icon name="boxOut" size={15} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {d.client_name ?? 'Без клиента'}
          </span>
          {d.dispatch_number && <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', flexShrink: 0 }}>{d.dispatch_number}</span>}
        </div>
        {(enrich?.sku != null || enrich?.qty != null || (d.allocated_qty ?? 0) > 0) && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>
            {[
              enrich?.sku != null ? `${enrich.sku} SKU` : null,
              (d.allocated_qty ?? 0) > 0 ? `${d.allocated_qty} шт в рейсе` : (enrich?.qty != null ? `${enrich.qty} шт` : null),
            ].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      {status && <Badge tone={(DISPATCH_STATUS_TONES[status] ?? '') as BadgeTone} dot>{DISPATCH_STATUS_LABELS[status] ?? status}</Badge>}
      {onRemove && (
        <button type="button" className="btn ghost icon sm" title="Отвязать" onClick={(e) => { e.stopPropagation(); onRemove() }}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  )
}
