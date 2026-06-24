import { useEffect, useMemo, useState } from 'react'
import { getReceipts, RECEIPT_TRIP_SELECTABLE_STATUSES } from '../../api/receiptsApi'
import { getDispatches, DISPATCH_TRIP_SELECTABLE_STATUSES } from '../../api/dispatchApi'
import type { TripDirection, TripCargoType } from '../../api/tripsApi'
import { Icon } from '../../components/Icon'
import { fmtDate } from '../../utils/format'

// Документ-кандидат для привязки к рейсу (единый вид для поступлений и отгрузок).
export type TripPickDoc = {
  id: string
  doc_number: string
  client_name: string | null
  sku: number
  qty: number
  date: string | null
  status_label: string
}

function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim()
}

/**
 * Выбор документов целиком для рейса (без построчного распределения): поступления для
 * inbound, отгрузки для outbound. Каждый отмеченный документ уходит в рейс полностью.
 */
export function TripDocPickerSheet({
  direction,
  cargoType,
  tripId,
  excludeIds = [],
  onConfirm,
  onClose,
}: {
  direction: TripDirection
  cargoType: TripCargoType
  // Существующий рейс — его id (исключает уже привязанное к нему); новый — 'new'.
  tripId: string
  excludeIds?: string[]
  onConfirm: (docs: TripPickDoc[]) => void
  onClose: () => void
}) {
  const outbound = direction === 'outbound'
  const [items, setItems] = useState<TripPickDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError('')
    const p = outbound
      ? getDispatches(
          { status: DISPATCH_TRIP_SELECTABLE_STATUSES, cargo_type: cargoType, available_for_trip_id: tripId, limit: 100 },
          ac.signal,
        ).then((res) =>
          res.items.map((d): TripPickDoc => ({
            id: d.id,
            doc_number: d.doc_number,
            client_name: d.client_name,
            sku: d.sku_count,
            qty: d.total_qty,
            date: d.ship_date,
            status_label: d.status_label,
          })),
        )
      : getReceipts(
          { status: RECEIPT_TRIP_SELECTABLE_STATUSES, available_for_trip_id: tripId, limit: 100 },
          ac.signal,
        ).then((res) =>
          res.items.map((r): TripPickDoc => ({
            id: r.id,
            doc_number: r.doc_number,
            client_name: r.client_name,
            sku: r.sku_count,
            qty: r.total_planned,
            date: r.arrival_date,
            status_label: '',
          })),
        )
    p.then((rows) => { if (!ac.signal.aborted) setItems(rows) })
      .catch((err) => { if (!ac.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить документы') })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [outbound, cargoType, tripId])

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds])
  const filtered = useMemo(() => {
    const needle = fold(search)
    const base = items.filter((d) => !exclude.has(d.id))
    if (!needle) return base
    return base.filter((d) => fold(`${d.doc_number} ${d.client_name ?? ''}`).includes(needle))
  }, [items, search, exclude])

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function submit() {
    const docs = items.filter((d) => picked.has(d.id))
    if (docs.length === 0) return
    onConfirm(docs)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>{outbound ? 'Добавить отгрузки' : 'Добавить поступления'}</h3>

        <div className="input search-wrap" style={{ marginBottom: 10 }}>
          <Icon name="search" size={18} />
          <input
            type="search"
            inputMode="search"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Поиск по номеру или клиенту"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && (
          <div className="alert" style={{ marginBottom: 8 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        {loading ? (
          <div className="center" style={{ padding: '24px 0' }}>
            <div className="spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="line-sub" style={{ padding: '16px 0' }}>
            {outbound ? 'Нет отгрузок, готовых к рейсу.' : 'Нет поступлений «В плане».'}
          </div>
        ) : (
          <div className="combo-list" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            {filtered.map((d) => {
              const on = picked.has(d.id)
              return (
                <button
                  key={d.id}
                  type="button"
                  className="line-row"
                  onClick={() => toggle(d.id)}
                  style={{
                    alignItems: 'center', marginTop: 0, padding: '9px 6px', width: '100%',
                    background: on ? 'var(--c-bg-sunken)' : 'transparent', border: 'none',
                    borderRadius: 'var(--r-md)', textAlign: 'left', cursor: 'pointer',
                  }}
                >
                  <span className={`pick-cb${on ? ' on' : ''}`}>{on && <Icon name="check" size={13} />}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-title" style={{ fontSize: 14 }}>
                      {d.doc_number}
                      {d.client_name ? ` · ${d.client_name}` : ''}
                    </div>
                    <div className="tile-meta">
                      {d.sku} SKU · {d.qty} шт
                      {d.date ? ` · ${fmtDate(d.date, '')}` : ''}
                      {d.status_label ? ` · ${d.status_label}` : ''}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 10 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>Отмена</button>
          <button className="btn" style={{ flex: 2 }} disabled={picked.size === 0} onClick={submit}>
            {picked.size > 0 ? `Добавить · ${picked.size}` : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  )
}
