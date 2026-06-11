import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { TripShipmentItem } from '../../../../api/tripsApi'
import type { ShipmentListItem } from '../../../../api/shipmentsApi'
import { Icon } from '../../../primitives/Icon'
import { Badge } from '../../../primitives/Badge'
import { ExpandableShipmentRow } from '../components/ExpandableShipmentRow'
import { Panel } from './panels'
import { LinkShipmentDrawer } from './components/LinkShipmentDrawer'

/** SKU/шт для привязанных отгрузок (из кандидатов-«В плане», если доступны). */
export type ShipmentEnrich = Record<string, { sku?: number | null; qty?: number | null }>

export type ShipmentLink = {
  options: ShipmentListItem[]
  tripNumber: string
  tripDestination: string | null
  onLink: (shipmentIds: string[]) => Promise<void>
  onUnlink: (shipmentDocId: string) => void
  busy?: boolean
}

/** Блок «Отгрузки в рейсе» — зеркало ReceiptsBlock: карточки отгрузок + привязка через Drawer. */
export function ShipmentsBlock({ title = 'Отгрузки в рейсе', right, shipments, enrich, onOpen, link, onUnlink, footerNote, expandable, resetKey }: {
  title?: string
  right?: ReactNode
  shipments: TripShipmentItem[]
  enrich?: ShipmentEnrich
  onOpen?: (shipmentDocId: string) => void
  link?: ShipmentLink
  /** Открепление без блока привязки (рейс уже в погрузке). Игнорируется, если задан link. */
  onUnlink?: (shipmentDocId: string) => void
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
  const totalQty = shipments.reduce((s, sh) => s + (enrich?.[sh.shipment_doc_id]?.qty ?? 0), 0)
  const allOpen = shipments.length > 0 && open.size === shipments.length

  const toggleOne = (id: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(shipments.map((s) => s.shipment_doc_id)))

  const headerRight = right ?? (
    canExpand ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <span className="t-sub">{shipments.length} отгрузки{totalQty > 0 ? ` · ${totalQty} шт` : ''}</span>
        {shipments.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={toggleAll}>
            <Icon name={allOpen ? 'chevUp' : 'chevDown'} size={13} />
            {allOpen ? 'Свернуть все' : 'Развернуть все'}
          </button>
        )}
      </span>
    ) : <Badge tone="accent">{shipments.length}</Badge>
  )

  return (
    <Panel icon="boxOut" title={title} right={headerRight}>
      {shipments.length === 0 ? (
        <div className="t-sub" style={{ padding: '2px 0 4px' }}>Отгрузки ещё не привязаны</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shipments.map((s) => {
            if (canExpand) {
              return (
                <ExpandableShipmentRow
                  key={s.line_id}
                  r={{
                    shipment_doc_id: s.shipment_doc_id,
                    shipment_number: s.shipment_number ?? null,
                    client_name: s.client_name ?? null,
                    shipment_status: s.shipment_status,
                  }}
                  open={open.has(s.shipment_doc_id)}
                  onToggle={() => toggleOne(s.shipment_doc_id)}
                  onOpen={() => onOpen!(s.shipment_doc_id)}
                  onRemove={unlink ? () => unlink(s.shipment_doc_id) : undefined}
                />
              )
            }
            // Обычная (не раскрываемая) карточка
            const e = enrich?.[s.shipment_doc_id]
            return (
              <ShipmentCardSimple
                key={s.line_id}
                s={s}
                enrich={e}
                onOpen={onOpen ? () => onOpen(s.shipment_doc_id) : undefined}
                onRemove={unlink ? () => unlink(s.shipment_doc_id) : undefined}
              />
            )
          })}
        </div>
      )}

      {canExpand && shipments.length > 0 && (
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
            marginTop: shipments.length ? 10 : 6, padding: '12px',
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

      {link && (
        <LinkShipmentDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          tripNumber={link.tripNumber}
          tripDestination={link.tripDestination}
          candidates={link.options}
          busy={link.busy}
          onLink={link.onLink}
        />
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Простая (не раскрываемая) карточка — используется когда expandable не задан

import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONES } from '../../../../api/shipmentsApi'
import type { ShipmentStatus } from '../../../../api/shipmentsApi'
import type { BadgeTone } from '../../../primitives/Badge'

function ShipmentCardSimple({ s, enrich, onOpen, onRemove }: {
  s: TripShipmentItem
  enrich?: { sku?: number | null; qty?: number | null }
  onOpen?: () => void
  onRemove?: () => void
}) {
  const status = (s.shipment_status ?? '') as ShipmentStatus
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
            {s.client_name ?? 'Без клиента'}
          </span>
          {s.shipment_number && <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', flexShrink: 0 }}>{s.shipment_number}</span>}
        </div>
        {(enrich?.sku != null || enrich?.qty != null) && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 1 }}>
            {[enrich?.sku != null ? `${enrich.sku} SKU` : null, enrich?.qty != null ? `${enrich.qty} шт` : null].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
      {status && <Badge tone={(SHIPMENT_STATUS_TONES[status] ?? '') as BadgeTone} dot>{SHIPMENT_STATUS_LABELS[status] ?? status}</Badge>}
      {onRemove && (
        <button type="button" className="btn ghost icon sm" title="Отвязать" onClick={(e) => { e.stopPropagation(); onRemove() }}>
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  )
}
