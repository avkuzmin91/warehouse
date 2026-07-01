import { useEffect, useMemo, useState } from 'react'
import { getPlannableItems, type PlannableItem, type InvQuality } from '../../api/balancesApi'
import { getDispatchReservations, type DispatchCargoType } from '../../api/dispatchApi'
import { balanceKey } from '../../utils/balanceKey'
import { lineStockChips } from '../../utils/stockChips'
import { Icon } from '../../components/Icon'

function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim()
}

function variantLabel(b: PlannableItem): string {
  return [b.product_sku || 'без SKU', b.color_name, b.size_name].filter(Boolean).join(' · ')
}

/**
 * Выбор позиций из остатков (склад + в пути) для «Задачи упаковки»/«Отгрузки».
 * Мобильный аналог веб-BalancePicker: список с поиском, у каждой позиции степпер,
 * добавляются все отмеченные разом.
 */
export function BalancePickerSheet({
  clientId,
  cargoType,
  source = 'pack',
  existingKeys = [],
  onAddMany,
  onClose,
}: {
  clientId: string
  cargoType: InvQuality
  // `dispatch` — для «Отгрузки»: главная цифра — упакованное (ready), склад/в пути добираются.
  source?: 'pack' | 'dispatch'
  existingKeys?: string[]
  onAddMany: (rows: { item: PlannableItem; qty: number }[]) => void
  onClose: () => void
}) {
  const isDispatch = source === 'dispatch'
  const [items, setItems] = useState<PlannableItem[]>([])
  const [reservedMap, setReservedMap] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    const reservedP = isDispatch
      ? getDispatchReservations({ client_id: clientId, cargo_type: cargoType as DispatchCargoType }, ac.signal)
          .then((r) => r.items)
          .catch(() => [])
      : Promise.resolve([] as Awaited<ReturnType<typeof getDispatchReservations>>['items'])
    Promise.all([
      getPlannableItems({ client_id: clientId, cargo_type: cargoType, limit: 500 }, ac.signal),
      reservedP,
    ])
      .then(([res, reservations]) => {
        if (ac.signal.aborted) return
        const map: Record<string, number> = {}
        for (const rv of reservations) map[balanceKey(rv)] = rv.reserved
        setReservedMap(map)
        setItems(res.items)
      })
      .catch((err) => { if (!ac.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить остатки') })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [clientId, cargoType, isDispatch])

  const existing = useMemo(() => new Set(existingKeys), [existingKeys])

  const filtered = useMemo(() => {
    const needle = fold(search)
    const base = items.filter((b) => !existing.has(balanceKey(b)))
    if (!needle) return base
    return base.filter((b) => fold(`${b.product_name} ${variantLabel(b)}`).includes(needle))
  }, [items, search, existing])

  const dispatchGood = isDispatch && cargoType !== 'defect'
  function ready(b: PlannableItem): number {
    // «Готов к отгрузке» = разложенное ready + упакованное на столе (packed) — оба отгружаемы.
    return dispatchGood ? b.ready_good + (b.packed_good ?? 0) : 0
  }
  function storage(b: PlannableItem): number {
    return cargoType === 'defect' ? b.storage_defect : b.storage_good
  }
  function transitOf(b: PlannableItem): number {
    return cargoType === 'defect' ? 0 : b.in_transit
  }
  function cap(b: PlannableItem): number {
    return ready(b) + storage(b) + transitOf(b)
  }
  function stockChips(b: PlannableItem) {
    return lineStockChips(b, { source, cargoType, reserved: reservedMap[balanceKey(b)] ?? 0 })
  }

  function setQ(b: PlannableItem, n: number) {
    const k = balanceKey(b)
    const clamped = Math.max(0, Math.min(Math.floor(n), cap(b)))
    setQty((prev) => {
      const next = { ...prev }
      if (clamped <= 0) delete next[k]
      else next[k] = clamped
      return next
    })
  }

  const selected = useMemo(
    () => filtered.filter((b) => (qty[balanceKey(b)] ?? 0) > 0).map((b) => ({ item: b, qty: qty[balanceKey(b)] })),
    [filtered, qty],
  )
  const totalQty = selected.reduce((s, r) => s + r.qty, 0)

  function submit() {
    if (selected.length === 0) return
    onAddMany(selected)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Добавить товар</h3>

        <div className="input search-wrap" style={{ marginBottom: 10 }}>
          <Icon name="search" size={18} />
          <input
            type="search"
            inputMode="search"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Поиск по товару или SKU"
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
          <div className="line-sub" style={{ padding: '16px 0' }}>Нет доступных остатков.</div>
        ) : (
          <div className="combo-list" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            {filtered.map((b) => {
              const k = balanceKey(b)
              const n = qty[k] ?? 0
              return (
                <div key={k} className="line-row" style={{ alignItems: 'flex-start', marginTop: 0, padding: '8px 0' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-title" style={{ fontSize: 14 }}>{b.product_name}</div>
                    <div className="tile-meta">{variantLabel(b)}</div>
                    <div className="stock-row">
                      {stockChips(b).map((c) => (
                        <span key={c.label} className={`badge ${c.tone}`}>
                          {c.label} <b>{c.value}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                  <input
                    className="input num"
                    inputMode="numeric"
                    value={n ? String(n) : ''}
                    placeholder="0"
                    aria-label="Количество"
                    onChange={(e) => setQ(b, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                    style={{ width: 72, flexShrink: 0 }}
                  />
                </div>
              )
            })}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 10 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>Отмена</button>
          <button className="btn" style={{ flex: 2 }} disabled={selected.length === 0} onClick={submit}>
            {selected.length > 0 ? `Добавить · ${selected.length} · ${totalQty} шт` : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  )
}
