import { useEffect, useMemo, useState } from 'react'
import {
  getInventoryProducts,
  getInventoryProductVariants,
} from '../../../../api/inventoryLookupsApi'
import type { ProductVariantPair } from '../../../../api/inventoryLookupsApi'
import type { InventoryProductLookup } from '../../../../api/domainTypes'
import { Drawer } from '../../../feedback/Drawer'
import { Checkbox } from '../../../primitives/Checkbox'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'
import { foldCiSearch } from '../../../../utils/foldCiSearch'

export type MatrixCell = {
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  qty: number
}

export type ProductMatrixEntry = {
  product: InventoryProductLookup
  cells: MatrixCell[]
}

type Props = {
  open: boolean
  clientId: string
  /** Ключи уже добавленных вариантов: product_id|color_id|size_id (как receiptLineVariantKey). */
  existingKeys?: string[]
  title?: string
  onClose: () => void
  onSubmit: (entries: ProductMatrixEntry[]) => void | Promise<void>
}

type Axis = { id: string | null; name: string | null; order?: number | null }

const NULL = '∅'
function axisKey(id: string | null): string {
  return id ?? NULL
}
function cellKey(colorId: string | null, sizeId: string | null): string {
  return `${axisKey(colorId)}|${axisKey(sizeId)}`
}
function existKey(productId: string, colorId: string | null, sizeId: string | null): string {
  return [productId, colorId ?? '', sizeId ?? ''].join('|')
}

function axesFromVariants(variants: ProductVariantPair[]) {
  const colors = new Map<string, Axis>()
  const sizes = new Map<string, Axis>()
  const valid = new Set<string>()
  let hasColor = false
  let hasSize = false
  for (const v of variants) {
    if (v.color_id) hasColor = true
    if (v.size_id) hasSize = true
    colors.set(axisKey(v.color_id), { id: v.color_id, name: v.color_name })
    sizes.set(axisKey(v.size_id), { id: v.size_id, name: v.size_name, order: v.size_sort_order ?? null })
    valid.add(cellKey(v.color_id, v.size_id))
  }
  // Ось размеров — по sort_order справочника; без порядка — по имени после упорядоченных.
  const sizeAxis = [...sizes.values()].sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order
    if (a.order != null) return -1
    if (b.order != null) return 1
    return (a.name ?? '').localeCompare(b.name ?? '', 'ru')
  })
  return { colorAxis: [...colors.values()], sizeAxis, validSet: valid, hasColor, hasSize }
}

/**
 * Массовый ввод строк сразу по нескольким товарам: список товаров клиента с чекбоксами,
 * у отмеченного прямо под строкой разворачивается сетка «цвет × размер». Несуществующие пары
 * недоступны, уже добавленные варианты помечены. Один сабмит отдаёт пачку по всем отмеченным.
 */
export function MatrixAddDrawer({ open, clientId, existingKeys = [], title = 'Добавить товары', onClose, onSubmit }: Props) {
  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, ProductVariantPair[]>>({})
  const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({})
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, Record<string, number>>>({})
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sessionLines, setSessionLines] = useState(0)
  const [sessionQty, setSessionQty] = useState(0)

  useEffect(() => {
    if (open && clientId) {
      getInventoryProducts(clientId).then(setProducts)
    }
  }, [open, clientId])

  const existing = useMemo(() => new Set(existingKeys), [existingKeys])

  const filtered = useMemo(() => {
    const q = foldCiSearch(filter.trim())
    if (!q) return products
    return products.filter((p) => foldCiSearch(`${p.name} ${p.sku}`).includes(q))
  }, [products, filter])

  function ensureVariants(productId: string) {
    if (variantsByProduct[productId] || loadingIds[productId]) return
    setLoadingIds((m) => ({ ...m, [productId]: true }))
    getInventoryProductVariants(productId)
      .then((res) => setVariantsByProduct((m) => ({ ...m, [productId]: res })))
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingIds((m) => ({ ...m, [productId]: false })))
  }

  function toggle(productId: string) {
    setError('')
    setChecked((m) => {
      const next = { ...m, [productId]: !m[productId] }
      if (next[productId]) ensureVariants(productId)
      else setQtyByProduct((q) => { const c = { ...q }; delete c[productId]; return c })
      return next
    })
  }

  function setCell(productId: string, colorId: string | null, sizeId: string | null, raw: string) {
    const k = cellKey(colorId, sizeId)
    const n = parseInt(raw.replace(/\D/g, ''), 10)
    setQtyByProduct((prev) => {
      const cur = { ...(prev[productId] ?? {}) }
      if (!raw || !Number.isFinite(n) || n <= 0) delete cur[k]
      else cur[k] = n
      return { ...prev, [productId]: cur }
    })
  }

  function cellsForProduct(product: InventoryProductLookup): MatrixCell[] {
    const variants = variantsByProduct[product.id]
    if (!variants) return []
    const q = qtyByProduct[product.id] ?? {}
    const out: MatrixCell[] = []
    for (const v of variants) {
      const val = q[cellKey(v.color_id, v.size_id)]
      if (!val || val <= 0) continue
      if (existing.has(existKey(product.id, v.color_id, v.size_id))) continue
      out.push({ color_id: v.color_id, color_name: v.color_name, size_id: v.size_id, size_name: v.size_name, qty: val })
    }
    return out
  }

  const entries = useMemo<ProductMatrixEntry[]>(() => {
    const out: ProductMatrixEntry[] = []
    for (const p of products) {
      if (!checked[p.id]) continue
      const cells = cellsForProduct(p)
      if (cells.length > 0) out.push({ product: p, cells })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, checked, qtyByProduct, variantsByProduct, existing])

  const totalLines = entries.reduce((s, e) => s + e.cells.length, 0)
  const totalQty = entries.reduce((s, e) => s + e.cells.reduce((a, c) => a + c.qty, 0), 0)
  const checkedCount = Object.values(checked).filter(Boolean).length

  async function handleSubmit() {
    if (entries.length === 0) { setError('Проставьте количество хотя бы для одного товара'); return }
    setError('')
    setSubmitting(true)
    try {
      await onSubmit(entries)
      setSessionLines((n) => n + totalLines)
      setSessionQty((n) => n + totalQty)
      // Не закрываем шторку: чистим выбор для следующей пачки.
      setChecked({})
      setQtyByProduct({})
      setSubmitting(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Отметьте товары галочкой и проставьте количество — за один раз можно добавить несколько"
      width={760}
      footer={
        <>
          {sessionLines > 0 && (
            <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--c-text-subtle)', alignSelf: 'center' }}>
              Добавлено: <b style={{ color: 'var(--c-text)' }}>{sessionLines}</b> строк · {sessionQty} шт
            </span>
          )}
          <button className="btn" onClick={onClose} disabled={submitting}>
            {sessionLines > 0 ? 'Готово' : 'Отмена'}
          </button>
          <button className="btn primary" disabled={entries.length === 0 || submitting} onClick={() => void handleSubmit()}>
            <Icon name="plus" size={13} />
            {submitting
              ? 'Добавление…'
              : `Добавить${entries.length > 0 ? ` · ${entries.length} тов · ${totalLines} строк · ${totalQty} шт` : ''}`}
          </button>
        </>
      }
    >
      {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

      <input
        className="input sm"
        placeholder="Поиск товара по названию или SKU…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ width: '100%', marginBottom: 12 }}
      />

      {products.length === 0 ? (
        <div style={{ padding: '24px 0' }}>
          <EmptyState title="Нет товаров" sub="У клиента не заведены товары" />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '24px 0' }}>
          <EmptyState title="Ничего не найдено" sub="Измените запрос поиска" />
        </div>
      ) : (
        <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          {filtered.map((p, i) => {
            const isChecked = !!checked[p.id]
            const variants = variantsByProduct[p.id]
            const loading = !!loadingIds[p.id]
            const cnt = cellsForProduct(p).length
            return (
              <div key={p.id} style={{ borderTop: i === 0 ? undefined : '1px solid var(--c-border)' }}>
                <div
                  role="checkbox"
                  aria-checked={isChecked}
                  tabIndex={0}
                  onClick={() => toggle(p.id)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    toggle(p.id)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
                    background: isChecked ? 'var(--c-accent-bg)' : undefined,
                  }}
                >
                  <Checkbox checked={isChecked} onChange={() => toggle(p.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 450, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.name}
                    </div>
                    <div className="t-sub mono" style={{ fontSize: 11.5 }}>{p.sku_pending ? 'Без SKU' : p.sku}</div>
                  </div>
                  {isChecked && cnt > 0 && (
                    <span style={{ fontSize: 11.5, color: 'var(--c-accent)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {cnt} строк
                    </span>
                  )}
                </div>

                {isChecked && (
                  <div style={{ padding: '0 12px 12px 38px' }}>
                    {loading && <div style={{ color: 'var(--c-text-muted)', fontSize: 12.5, padding: '4px 0' }}>Загрузка вариантов…</div>}
                    {!loading && variants && variants.length === 0 && (
                      <div style={{ color: 'var(--c-text-subtle)', fontSize: 12.5, padding: '4px 0' }}>
                        У товара не заведены складские варианты (цвет/размер)
                      </div>
                    )}
                    {!loading && variants && variants.length > 0 && (
                      <ProductMatrix
                        productId={p.id}
                        variants={variants}
                        qty={qtyByProduct[p.id] ?? {}}
                        isExisting={(c, s) => existing.has(existKey(p.id, c, s))}
                        onCell={(c, s, raw) => setCell(p.id, c, s, raw)}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {checkedCount > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--c-text-subtle)' }}>
          Выбрано товаров: <b style={{ color: 'var(--c-text)' }}>{checkedCount}</b>
        </div>
      )}
    </Drawer>
  )
}

function ProductMatrix({
  variants,
  qty,
  isExisting,
  onCell,
}: {
  productId: string
  variants: ProductVariantPair[]
  qty: Record<string, number>
  isExisting: (colorId: string | null, sizeId: string | null) => boolean
  onCell: (colorId: string | null, sizeId: string | null, raw: string) => void
}) {
  const { colorAxis, sizeAxis, validSet, hasColor, hasSize } = useMemo(() => axesFromVariants(variants), [variants])
  const singleCell = !hasColor && !hasSize

  if (singleCell) {
    const taken = isExisting(null, null)
    const k = cellKey(null, null)
    return taken ? (
      <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', padding: '4px 0' }}>Этот товар уже добавлен</div>
    ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>Количество</span>
        <input
          className="input sm"
          inputMode="numeric"
          placeholder="0"
          value={qty[k] ? String(qty[k]) : ''}
          onChange={(e) => onCell(null, null, e.target.value)}
          style={{ width: 120 }}
        />
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', marginTop: 4 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={thStyle('left', true)}>{hasColor ? 'Цвет \\ Размер' : 'Размер'}</th>
            {sizeAxis.map((s) => (
              <th key={axisKey(s.id)} style={thStyle('center')}>{s.name ?? '—'}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {colorAxis.map((c) => (
            <tr key={axisKey(c.id)}>
              <td style={rowHeadStyle}>{c.name ?? '—'}</td>
              {sizeAxis.map((s) => {
                const valid = validSet.has(cellKey(c.id, s.id))
                const taken = isExisting(c.id, s.id)
                const k = cellKey(c.id, s.id)
                return (
                  <td key={axisKey(s.id)} style={{ padding: 3, textAlign: 'center', background: !valid ? 'var(--c-bg-sunken)' : undefined }}>
                    {!valid ? (
                      <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
                    ) : taken ? (
                      <span title="Вариант уже добавлен" style={{ color: 'var(--c-text-subtle)' }}>
                        <Icon name="check" size={12} />
                      </span>
                    ) : (
                      <input
                        inputMode="numeric"
                        value={qty[k] ? String(qty[k]) : ''}
                        placeholder="0"
                        onChange={(e) => onCell(c.id, s.id, e.target.value)}
                        style={cellInputStyle(!!qty[k])}
                      />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function thStyle(align: 'left' | 'center' | 'right', sticky = false): React.CSSProperties {
  return {
    padding: '6px 8px',
    textAlign: align,
    fontWeight: 500,
    color: 'var(--c-text-subtle)',
    background: 'var(--c-bg-sunken)',
    borderBottom: '1px solid var(--c-border)',
    whiteSpace: 'nowrap',
    ...(sticky ? { position: 'sticky', left: 0, zIndex: 1, minWidth: 110 } : { minWidth: 48 }),
  }
}

const rowHeadStyle: React.CSSProperties = {
  padding: '4px 8px',
  position: 'sticky',
  left: 0,
  background: 'var(--c-bg-elev)',
  borderRight: '1px solid var(--c-border)',
  whiteSpace: 'nowrap',
}

function cellInputStyle(filled: boolean): React.CSSProperties {
  return {
    width: 44,
    height: 30,
    textAlign: 'center',
    padding: '0 4px',
    border: '1px solid var(--c-border)',
    borderRadius: 'var(--r-sm)',
    background: 'var(--c-bg-elev)',
    fontFamily: 'var(--font-num)',
    fontVariantNumeric: 'tabular-nums',
    fontSize: 13,
    color: filled ? 'var(--c-text)' : 'var(--c-text-subtle)',
  }
}
