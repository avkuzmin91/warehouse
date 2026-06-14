import { useMemo, useState } from 'react'
import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_TONES } from '../../../../../api/shipmentsApi'
import type { ShipmentListItem } from '../../../../../api/shipmentsApi'
import { Icon } from '../../../../primitives/Icon'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { foldCiSearch } from '../../../../../utils/foldCiSearch'
import { fmtDateShort } from '../../../../../utils/format'

export type LinkShipmentDrawerProps = {
  open: boolean
  onClose: () => void
  tripNumber: string
  tripDestination: string | null
  candidates: ShipmentListItem[]
  busy?: boolean
  onLink: (shipmentIds: string[]) => Promise<void>
}

function CandidateShipmentRow({ item, checked, onToggle }: {
  item: ShipmentListItem
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
        padding: '10px 11px', borderRadius: 'var(--r-lg)', cursor: 'pointer',
        border: `1px solid ${checked ? 'var(--c-accent)' : 'var(--c-border)'}`,
        background: checked ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)',
        boxShadow: checked ? '0 0 0 3px color-mix(in oklab, var(--c-accent) 8%, transparent)' : 'none',
        transition: 'background 80ms, border-color 80ms, box-shadow 80ms', fontFamily: 'inherit',
      }}
    >
      <span style={{
        width: 18, height: 18, borderRadius: 5, flexShrink: 0,
        border: `1.5px solid ${checked ? 'var(--c-accent)' : 'var(--c-border-strong)'}`,
        background: checked ? 'var(--c-accent)' : 'var(--c-bg-elev)',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && <Icon name="check" size={12} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.client_name ?? 'Без клиента'}
          </span>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', flexShrink: 0 }}>{item.doc_number}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{item.sku_count} SKU · {item.total_qty} шт</span>
          {item.ship_date && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              <Icon name="calendar" size={11} />{fmtDateShort(item.ship_date)}
            </span>
          )}
        </div>
      </div>
      <Badge tone={(SHIPMENT_STATUS_TONES[item.status] ?? '') as BadgeTone} dot>
        {SHIPMENT_STATUS_LABELS[item.status] ?? item.status}
      </Badge>
    </button>
  )
}

/** Правая шторка «Отгрузки в рейс»: привязка существующих отгрузок «В плане». */
export function LinkShipmentDrawer({ open, onClose, tripNumber, tripDestination, candidates, busy, onLink }: LinkShipmentDrawerProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function reset() {
    setQuery('')
    setSelected(new Set())
  }
  function close() {
    reset()
    onClose()
  }

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return candidates
    const f = foldCiSearch(q)
    return candidates.filter((s) => foldCiSearch(`${s.doc_number} ${s.client_name ?? ''}`).includes(f))
  }, [candidates, query])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectedQty = useMemo(
    () => candidates.filter((s) => selected.has(s.id)).reduce((sum, s) => sum + s.total_qty, 0),
    [candidates, selected],
  )

  async function handleLink() {
    if (selected.size === 0) return
    await onLink([...selected])
    close()
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(20,20,15,0.28)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
      }}
      onClick={close}
    >
      <div
        style={{
          width: 500, maxWidth: 'calc(100vw - 24px)',
          background: 'var(--c-bg-elev)', borderLeft: '1px solid var(--c-border)', boxShadow: 'var(--sh-3)',
          display: 'flex', flexDirection: 'column',
          animation: 'sheetIn 220ms cubic-bezier(.2,.7,.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 'var(--r-md)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--c-accent-bg)', color: 'var(--c-accent)',
            }}>
              <Icon name="boxOut" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>Отгрузки в рейс</div>
              <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', marginTop: 3 }}>
                Рейс <span className="mono" style={{ color: 'var(--c-text-muted)' }}>{tripNumber}</span> · черновик
                {tripDestination ? ` · ${tripDestination}` : ''}
              </div>
            </div>
            <button className="btn ghost icon sm" onClick={close}><Icon name="x" size={14} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'visible', padding: '16px 20px' }}>
          <div className="col gap-12">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Icon name="search" size={13} style={{ position: 'absolute', left: 10, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
              <input
                className="input sm"
                style={{ paddingLeft: 30, width: '100%' }}
                placeholder="Поиск: клиент, номер отгрузки…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              <Icon name="alert" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Показаны отгрузки (кроме завершённых), ещё не привязанные к рейсам.</span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--c-text-subtle)' }}>
                <Icon name="boxOut" size={26} style={{ color: 'var(--c-text-faint)' }} />
                <div style={{ fontSize: 13, fontWeight: 500, marginTop: 8, color: 'var(--c-text-muted)' }}>Ничего не нашлось</div>
              </div>
            ) : (
              <div className="col gap-8">
                {filtered.map((s) => (
                  <CandidateShipmentRow key={s.id} item={s} checked={selected.has(s.id)} onToggle={() => toggle(s.id)} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
            {selected.size > 0
              ? <>Выбрано: <b style={{ color: 'var(--c-text)' }}>{selected.size}</b> · <span className="mono">{selectedQty}</span> шт</>
              : 'Ничего не выбрано'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" onClick={close}>Отмена</button>
            <button className="btn primary" onClick={handleLink} disabled={selected.size === 0 || busy}>
              <Icon name="plus" size={13} />Привязать ({selected.size})
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes sheetIn { from { transform: translateX(24px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  )
}
