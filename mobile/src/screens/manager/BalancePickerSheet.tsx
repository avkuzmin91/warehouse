import { useEffect, useMemo, useState } from 'react'
import { getPlannableItems, type PlannableItem, type InvQuality } from '../../api/balancesApi'
import { balanceKey } from '../../utils/balanceKey'
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
  existingKeys = [],
  onAddMany,
  onClose,
}: {
  clientId: string
  cargoType: InvQuality
  existingKeys?: string[]
  onAddMany: (rows: { item: PlannableItem; qty: number }[]) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<PlannableItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    getPlannableItems({ client_id: clientId, cargo_type: cargoType, limit: 500 }, ac.signal)
      .then((res) => { if (!ac.signal.aborted) setItems(res.items) })
      .catch((err) => { if (!ac.signal.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить остатки') })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [clientId, cargoType])

  const existing = useMemo(() => new Set(existingKeys), [existingKeys])

  const filtered = useMemo(() => {
    const needle = fold(search)
    const base = items.filter((b) => !existing.has(balanceKey(b)))
    if (!needle) return base
    return base.filter((b) => fold(`${b.product_name} ${variantLabel(b)}`).includes(needle))
  }, [items, search, existing])

  function onHand(b: PlannableItem): number {
    return cargoType === 'defect' ? b.storage_defect : b.storage_good
  }
  function cap(b: PlannableItem): number {
    return onHand(b) + (cargoType === 'defect' ? 0 : b.in_transit)
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
              const available = onHand(b)
              const transit = cargoType === 'defect' ? 0 : b.in_transit
              return (
                <div key={k} className="line-row" style={{ alignItems: 'center', marginTop: 0, padding: '7px 0' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-title" style={{ fontSize: 14 }}>{b.product_name}</div>
                    <div className="tile-meta">
                      {variantLabel(b)} · склад {available}{transit > 0 ? ` · в пути ${transit}` : ''}
                    </div>
                  </div>
                  <div className="line-row" style={{ marginTop: 0, gap: 6, width: 'auto' }}>
                    <button className="btn ghost" onClick={() => setQ(b, n - 1)} aria-label="Меньше">−</button>
                    <input
                      className="input num"
                      inputMode="numeric"
                      value={n ? String(n) : ''}
                      placeholder="0"
                      onChange={(e) => setQ(b, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                      style={{ width: 56 }}
                    />
                    <button className="btn ghost" onClick={() => setQ(b, n + 1)} aria-label="Больше">+</button>
                  </div>
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
