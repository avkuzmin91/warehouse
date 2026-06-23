import { useEffect, useMemo, useState } from 'react'
import {
  getProducts,
  getProductVariants,
  type ProductLookup,
  type ProductVariantPair,
} from '../../api/lookupsApi'
import { Combobox } from '../../components/Combobox'
import { Icon } from '../../components/Icon'

export type MatrixCell = {
  color_id: string | null
  color_name: string | null
  size_id: string | null
  size_name: string | null
  qty: number
}

const NULL = '∅'
function cellKey(colorId: string | null, sizeId: string | null): string {
  return `${colorId ?? NULL}|${sizeId ?? NULL}`
}

function variantLabel(v: ProductVariantPair): string {
  const parts = [v.color_name, v.size_name].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Без варианта'
}

/**
 * Массовый ввод строк «цвет × размер» на телефоне: товар выбирается один раз,
 * затем для каждого реально существующего варианта проставляется количество.
 * Вертикальный список со степперами — мобильная замена десктопной матрице.
 */
export function MatrixEntrySheet({
  clientId,
  existingKeys = [],
  onClose,
  onSubmit,
}: {
  clientId: string
  existingKeys?: string[]
  onClose: () => void
  onSubmit: (product: ProductLookup, cells: MatrixCell[]) => void
}) {
  const [products, setProducts] = useState<ProductLookup[]>([])
  const [productId, setProductId] = useState('')
  const [variants, setVariants] = useState<ProductVariantPair[]>([])
  const [loadingVariants, setLoadingVariants] = useState(false)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [fillValue, setFillValue] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const ac = new AbortController()
    getProducts(clientId, ac.signal)
      .then((res) => { if (!ac.signal.aborted) setProducts(res) })
      .catch(() => { /* aborted */ })
    return () => ac.abort()
  }, [clientId])

  const selectedProduct = products.find((p) => p.id === productId)

  useEffect(() => {
    setQty({})
    setError('')
    setVariants([])
    if (!productId) return
    const ac = new AbortController()
    setLoadingVariants(true)
    getProductVariants(productId, ac.signal)
      .then((res) => { if (!ac.signal.aborted) setVariants(res) })
      .catch(() => { /* aborted */ })
      .finally(() => { if (!ac.signal.aborted) setLoadingVariants(false) })
    return () => ac.abort()
  }, [productId])

  const existing = useMemo(() => new Set(existingKeys), [existingKeys])
  function isExisting(colorId: string | null, sizeId: string | null): boolean {
    if (!selectedProduct) return false
    return existing.has([selectedProduct.id, colorId ?? '', sizeId ?? ''].join('|'))
  }

  function setCell(colorId: string | null, sizeId: string | null, n: number) {
    const k = cellKey(colorId, sizeId)
    setQty((prev) => {
      const next = { ...prev }
      if (!Number.isFinite(n) || n <= 0) delete next[k]
      else next[k] = Math.floor(n)
      return next
    })
  }

  function fillAll() {
    const n = parseInt(fillValue.replace(/\D/g, ''), 10)
    if (!Number.isFinite(n) || n <= 0) return
    setQty(() => {
      const next: Record<string, number> = {}
      for (const v of variants) {
        if (isExisting(v.color_id, v.size_id)) continue
        next[cellKey(v.color_id, v.size_id)] = n
      }
      return next
    })
  }

  const cells = useMemo<MatrixCell[]>(() => {
    const out: MatrixCell[] = []
    for (const v of variants) {
      const n = qty[cellKey(v.color_id, v.size_id)]
      if (!n || n <= 0) continue
      if (isExisting(v.color_id, v.size_id)) continue
      out.push({ color_id: v.color_id, color_name: v.color_name, size_id: v.size_id, size_name: v.size_name, qty: n })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty, variants, existing, selectedProduct])

  const totalQty = cells.reduce((s, c) => s + c.qty, 0)

  function submit() {
    if (!selectedProduct) { setError('Выберите товар'); return }
    if (cells.length === 0) { setError('Проставьте количество хотя бы для одного варианта'); return }
    onSubmit(selectedProduct, cells)
  }

  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.sku_pending ? `${p.name} · без SKU` : `${p.name} · ${p.sku}`,
  }))

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Добавить товары</h3>

        <div className="field">
          <div className="flabel">
            Товар <span className="req">*</span>
          </div>
          <Combobox
            value={productId}
            options={productOptions}
            placeholder="Поиск по SKU или названию…"
            title="Выберите товар"
            onChange={setProductId}
          />
        </div>

        {loadingVariants && (
          <div className="center" style={{ padding: '18px 0' }}>
            <div className="spin" />
          </div>
        )}

        {!loadingVariants && selectedProduct && variants.length === 0 && (
          <div className="line-sub" style={{ padding: '12px 0' }}>
            У товара не заведены варианты (цвет/размер).
          </div>
        )}

        {!loadingVariants && variants.length > 0 && (
          <>
            <div className="line-row" style={{ marginTop: 4 }}>
              <input
                className="input num"
                inputMode="numeric"
                placeholder="кол-во"
                value={fillValue}
                onChange={(e) => setFillValue(e.target.value.replace(/\D/g, ''))}
                style={{ flex: 1 }}
              />
              <button className="btn ghost" style={{ flex: 1 }} disabled={!fillValue} onClick={fillAll}>
                Заполнить всё
              </button>
            </div>

            <div className="combo-list" style={{ maxHeight: '46vh', overflowY: 'auto', marginTop: 8 }}>
              {variants.map((v) => {
                const k = cellKey(v.color_id, v.size_id)
                const taken = isExisting(v.color_id, v.size_id)
                const n = qty[k] ?? 0
                return (
                  <div key={k} className="line-row" style={{ alignItems: 'center', marginTop: 0, padding: '6px 0' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tile-title" style={{ fontSize: 14 }}>{variantLabel(v)}</div>
                    </div>
                    {taken ? (
                      <span className="badge success">
                        <Icon name="check" size={13} /> добавлен
                      </span>
                    ) : (
                      <input
                        className="input num"
                        inputMode="numeric"
                        value={n ? String(n) : ''}
                        placeholder="0"
                        onChange={(e) => setCell(v.color_id, v.size_id, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                        style={{ width: 72, flexShrink: 0 }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {error && (
          <div className="alert" style={{ marginTop: 8 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 10 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>
            Отмена
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={cells.length === 0} onClick={submit}>
            {cells.length > 0 ? `Добавить · ${cells.length} · ${totalQty} шт` : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  )
}
