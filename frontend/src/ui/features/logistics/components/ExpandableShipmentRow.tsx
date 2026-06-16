import { useState } from 'react'
import { getShipment } from '../../../../api/shipmentsApi'
import type { ShipmentLine } from '../../../../api/shipmentsApi'
import { useApi } from '../../../../hooks/useApi'
import { Icon } from '../../../primitives/Icon'
import { Badge } from '../../../primitives/Badge'
import type { BadgeTone } from '../../../primitives/Badge'
import { ShipmentLinesTable } from './ShipmentLinesTable'
import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONES } from '../../../../api/shipmentsApi'
import type { ShipmentStatus } from '../../../../api/shipmentsApi'
import type { TripShipmentAlloc } from '../../../../api/tripsApi'

export type ExpandableShipmentData = {
  shipment_doc_id: string
  shipment_number: string | null
  client_name: string | null
  shipment_status?: string | null
  allocated_qty?: number
  allocations?: TripShipmentAlloc[]
}

function LinesBody({ docId }: { docId: string }) {
  const [retry, setRetry] = useState(0)
  const { data, loading, error } = useApi(() => getShipment(docId), [docId, retry])
  const lines: ShipmentLine[] = data?.lines ?? []
  return <ShipmentLinesTable lines={lines} loading={loading} error={!!error} onRetry={() => setRetry((n) => n + 1)} />
}

/** Раскрываемая строка-отгрузка в карточке рейса: шапка-тоггл + inline-состав + переход в карточку. */
export function ExpandableShipmentRow({ r, open, onToggle, onOpen, onRemove }: {
  r: ExpandableShipmentData
  open: boolean
  onToggle: () => void
  onOpen: () => void
  onRemove?: () => void
}) {
  const [everOpened, setEverOpened] = useState(open)
  if (open && !everOpened) setEverOpened(true)

  const status = (r.shipment_status ?? '') as ShipmentStatus
  const allocs = r.allocations ?? []
  const hasAllocs = allocs.length > 0
  const tripQty = allocs.reduce((s, a) => s + a.qty, 0)

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
            <Icon name="boxOut" size={15} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.client_name ?? 'Без клиента'}
              </span>
              {r.shipment_number && <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', flexShrink: 0 }}>{r.shipment_number}</span>}
              {(r.allocated_qty ?? 0) > 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', flexShrink: 0 }}>· {r.allocated_qty} шт в рейсе</span>
              )}
            </div>
          </div>
        </button>

        {status && (
          <Badge tone={(SHIPMENT_STATUS_TONES[status] ?? '') as BadgeTone} dot>
            {SHIPMENT_STATUS_LABELS[status] ?? status}
          </Badge>
        )}
        <button
          type="button"
          className="btn ghost icon sm exp-open-btn"
          title="Открыть карточку отгрузки"
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
            {hasAllocs ? (
              <div>
                <div className="t-sub" style={{ marginBottom: 6 }}>В этом рейсе</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {allocs.map((a) => (
                    <div key={a.line_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span className="mono" style={{ color: 'var(--c-text-subtle)' }}>{a.product_sku}</span>{' '}{a.product_name}
                        {a.variant ? <span style={{ color: 'var(--c-text-subtle)' }}> · {a.variant}</span> : null}
                      </span>
                      <span className="num" style={{ fontWeight: 500 }}>{a.qty} шт</span>
                      <span className="t-sub" style={{ width: 118, flexShrink: 0, textAlign: 'right' }}>отгружено {a.shipped_qty}/{a.line_qty}</span>
                    </div>
                  ))}
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginTop: 8, paddingTop: 8, borderTop: '1.5px solid var(--c-border-strong)', color: 'var(--c-text-subtle)', fontSize: 12.5,
                }}>
                  <span>Итого</span>
                  <span className="mono" style={{ fontWeight: 600, color: 'var(--c-text)', fontVariantNumeric: 'tabular-nums' }}>
                    {allocs.length} SKU · {tripQty} шт
                  </span>
                </div>
              </div>
            ) : (
              everOpened && <LinesBody docId={r.shipment_doc_id} />
            )}

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
              marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--c-border)',
            }}>
              <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>Нужны реквизиты или состав?</span>
              <button type="button" className="btn sm" onClick={onOpen}>
                <Icon name="boxOut" size={13} />
                Открыть карточку отгрузки
                <Icon name="arrowRight" size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
