import { useEffect, useMemo, useState } from 'react'
import {
  getInventoryProducts,
  getInventoryProductVariants,
} from '../../../../api/inventoryLookupsApi'
import type { ProductVariantPair } from '../../../../api/inventoryLookupsApi'
import type { InventoryProductLookup } from '../../../../api/domainTypes'
import { Combobox } from '../../../data/Combobox'
import { Drawer } from '../../../feedback/Drawer'
import { EmptyState } from '../../../primitives/EmptyState'
import { Icon } from '../../../primitives/Icon'

export type MatrixCell = {
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  qty: number
}

type Props = {
  open: boolean
  clientId: string
  /** Ключи уже добавленных вариантов: product_id|color_id|size_id (как receiptLineVariantKey). */
  existingKeys?: string[]
  title?: string
  onClose: () => void
  onSubmit: (product: InventoryProductLookup, cells: MatrixCell[]) => void | Promise<void>
}

type Axis = { id: string | null; name: string | null }

const NULL = '∅'
function axisKey(id: string | null): string {
  return id ?? NULL
}
function cellKey(colorId: string | null, sizeId: string | null): string {
  return `${axisKey(colorId)}|${axisKey(sizeId)}`
}

/**
 * Массовый ввод строк через матрицу «цвет × размер»: товар выбирается один раз,
 * количества проставляются по всей сетке сразу. Источник сетки — реально
 * существующие варианты товара (product_variants), несуществующие пары недоступны.
 */
export function MatrixAddDrawer({ open, clientId, existingKeys = [], title = 'Добавить товары', onClose, onSubmit }: Props) {
  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [productId, setProductId] = useState('')
  const [variants, setVariants] = useState<ProductVariantPair[]>([])
  const [loadingVariants, setLoadingVariants] = useState(false)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [fillValue, setFillValue] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open && clientId) {
      getInventoryProducts(clientId).then(setProducts)
    }
  }, [open, clientId])

  const selectedProduct = products.find((p) => p.id === productId)

  useEffect(() => {
    setQty({})
    setError('')
    setVariants([])
    if (!productId) return
    const ctrl = new AbortController()
    setLoadingVariants(true)
    getInventoryProductVariants(productId, ctrl.signal)
      .then((res) => { if (!ctrl.signal.aborted) setVariants(res) })
      .catch(() => { /* aborted or error */ })
      .finally(() => { if (!ctrl.signal.aborted) setLoadingVariants(false) })
    return () => ctrl.abort()
  }, [productId])

  const { colorAxis, sizeAxis, validSet, hasColor, hasSize } = useMemo(() => {
    const colors = new Map<string, Axis>()
    const sizes = new Map<string, Axis>()
    const valid = new Set<string>()
    let anyColor = false
    let anySize = false
    for (const v of variants) {
      if (v.color_id) anyColor = true
      if (v.size_id) anySize = true
      colors.set(axisKey(v.color_id), { id: v.color_id, name: v.color_name })
      sizes.set(axisKey(v.size_id), { id: v.size_id, name: v.size_name })
      valid.add(cellKey(v.color_id, v.size_id))
    }
    return {
      colorAxis: [...colors.values()],
      sizeAxis: [...sizes.values()],
      validSet: valid,
      hasColor: anyColor,
      hasSize: anySize,
    }
  }, [variants])

  const existing = useMemo(() => new Set(existingKeys), [existingKeys])
  function isExisting(colorId: string | null, sizeId: string | null): boolean {
    if (!selectedProduct) return false
    return existing.has([selectedProduct.id, colorId ?? '', sizeId ?? ''].join('|'))
  }

  function setCell(colorId: string | null, sizeId: string | null, raw: string) {
    const k = cellKey(colorId, sizeId)
    const n = parseInt(raw.replace(/\D/g, ''), 10)
    setQty((prev) => {
      const next = { ...prev }
      if (!raw || !Number.isFinite(n) || n <= 0) delete next[k]
      else next[k] = n
      return next
    })
  }

  function fillCells(predicate: (c: Axis, s: Axis) => boolean) {
    const n = parseInt(fillValue.replace(/\D/g, ''), 10)
    if (!Number.isFinite(n) || n <= 0) return
    setQty((prev) => {
      const next = { ...prev }
      for (const c of colorAxis) {
        for (const s of sizeAxis) {
          if (!validSet.has(cellKey(c.id, s.id))) continue
          if (isExisting(c.id, s.id)) continue
          if (!predicate(c, s)) continue
          next[cellKey(c.id, s.id)] = n
        }
      }
      return next
    })
  }

  const cells = useMemo<MatrixCell[]>(() => {
    const out: MatrixCell[] = []
    for (const c of colorAxis) {
      for (const s of sizeAxis) {
        const v = qty[cellKey(c.id, s.id)]
        if (!v || v <= 0) continue
        if (!validSet.has(cellKey(c.id, s.id))) continue
        if (isExisting(c.id, s.id)) continue
        out.push({ color_id: c.id, color_name: c.name, size_id: s.id, size_name: s.name, qty: v })
      }
    }
    return out
  }, [qty, colorAxis, sizeAxis, validSet, selectedProduct, existing])

  const totalQty = cells.reduce((s, c) => s + c.qty, 0)

  function rowSum(colorId: string | null): number {
    let s = 0
    for (const sz of sizeAxis) s += qty[cellKey(colorId, sz.id)] ?? 0
    return s
  }
  function colSum(sizeId: string | null): number {
    let s = 0
    for (const c of colorAxis) s += qty[cellKey(c.id, sizeId)] ?? 0
    return s
  }

  async function handleSubmit() {
    if (!selectedProduct) { setError('Выберите товар'); return }
    if (cells.length === 0) { setError('Проставьте количество хотя бы для одного варианта'); return }
    setError('')
    setSubmitting(true)
    try {
      await onSubmit(selectedProduct, cells)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      setSubmitting(false)
    }
  }

  const showGrid = !!selectedProduct && !loadingVariants && variants.length > 0
  const singleCell = !hasColor && !hasSize

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Выберите товар и проставьте количество по всей сетке"
      width={760}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={submitting}>Отмена</button>
          <button className="btn primary" disabled={cells.length === 0 || submitting} onClick={() => void handleSubmit()}>
            <Icon name="plus" size={13} />
            {submitting ? 'Добавление…' : `Добавить${cells.length > 0 ? ` · ${cells.length} строк · ${totalQty} шт` : ''}`}
          </button>
        </>
      }
    >
      {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

      <div>
        <label className="field-label">
          <span>Товар (SKU) <span style={{ color: 'var(--c-danger)' }}>*</span></span>
        </label>
        <Combobox
          value={productId}
          placeholder="Поиск по SKU или названию…"
          options={products.map((p) => ({ value: p.id, label: p.name, sub: p.sku_pending ? 'Без SKU' : p.sku }))}
          onChange={(v) => setProductId(String(v ?? ''))}
          prefix="search"
        />
      </div>

      {loadingVariants && (
        <div style={{ color: 'var(--c-text-muted)', fontSize: 13, padding: '20px 0' }}>Загрузка вариантов…</div>
      )}

      {!loadingVariants && selectedProduct && variants.length === 0 && (
        <div style={{ padding: '24px 0' }}>
          <EmptyState title="Нет вариантов" sub="У товара не заведены складские варианты (цвет/размер)" />
        </div>
      )}

      {showGrid && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            margin: '14px 0 12px', padding: '8px 10px',
            background: 'var(--c-bg-sunken)', borderRadius: 'var(--r-md)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Быстрое заполнение:</span>
            <input
              className="input sm"
              inputMode="numeric"
              placeholder="кол-во"
              value={fillValue}
              onChange={(e) => setFillValue(e.target.value.replace(/\D/g, ''))}
              style={{ width: 78 }}
            />
            <button className="btn sm" disabled={!fillValue} onClick={() => fillCells(() => true)}>Заполнить всё</button>
            <button className="btn sm" disabled={Object.keys(qty).length === 0} onClick={() => setQty({})}>Очистить</button>
          </div>

          {singleCell ? (
            <SingleCellInput
              value={qty[cellKey(null, null)] ?? 0}
              disabled={isExisting(null, null)}
              onChange={(raw) => setCell(null, null, raw)}
            />
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={thStyle('left', true)}>{hasColor ? 'Цвет \\ Размер' : 'Размер'}</th>
                    {sizeAxis.map((s) => (
                      <th key={axisKey(s.id)} style={thStyle('center')}>
                        <div>{s.name ?? '—'}</div>
                        <button
                          className="btn ghost icon sm"
                          title="Заполнить столбец"
                          disabled={!fillValue}
                          onClick={() => fillCells((_c, sz) => sz.id === s.id)}
                          style={{ height: 18, width: 18 }}
                        >
                          <Icon name="arrowDown" size={11} />
                        </button>
                      </th>
                    ))}
                    <th style={thStyle('right')}>Σ</th>
                  </tr>
                </thead>
                <tbody>
                  {colorAxis.map((c) => (
                    <tr key={axisKey(c.id)}>
                      <td style={rowHeadStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ flex: 1, minWidth: 0 }}>{c.name ?? '—'}</span>
                          {hasColor && (
                            <button
                              className="btn ghost icon sm"
                              title="Заполнить строку"
                              disabled={!fillValue}
                              onClick={() => fillCells((col) => col.id === c.id)}
                              style={{ height: 18, width: 18 }}
                            >
                              <Icon name="arrowRight" size={11} />
                            </button>
                          )}
                        </div>
                      </td>
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
                                onChange={(e) => setCell(c.id, s.id, e.target.value)}
                                style={cellInputStyle(!!qty[k])}
                              />
                            )}
                          </td>
                        )
                      })}
                      <td style={sumCellStyle}>{rowSum(c.id) || ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '1px solid var(--c-border-strong)' }}>
                    <td style={{ ...rowHeadStyle, fontWeight: 600 }}>Итого</td>
                    {sizeAxis.map((s) => (
                      <td key={axisKey(s.id)} style={sumCellStyle}>{colSum(s.id) || ''}</td>
                    ))}
                    <td style={{ ...sumCellStyle, fontWeight: 600, color: 'var(--c-text)' }}>{totalQty || ''}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </Drawer>
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

const sumCellStyle: React.CSSProperties = {
  padding: '4px 8px',
  textAlign: 'right',
  color: 'var(--c-text-subtle)',
  fontFamily: 'var(--font-num)',
  fontVariantNumeric: 'tabular-nums',
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

function SingleCellInput({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (raw: string) => void }) {
  return (
    <div style={{ marginTop: 14 }}>
      <label className="field-label"><span>Количество <span style={{ color: 'var(--c-danger)' }}>*</span></span></label>
      {disabled ? (
        <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>Этот товар уже добавлен</div>
      ) : (
        <input
          className="input sm"
          inputMode="numeric"
          placeholder="0"
          value={value ? String(value) : ''}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 160 }}
        />
      )}
    </div>
  )
}
