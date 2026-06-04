import { useEffect, useState } from 'react'
import { addReceiptLine } from '../../../../../api/receiptsApi'
import {
  getInventoryColorsForProductSku,
  getInventoryProducts,
  getInventorySizesForProductSkuAndColor,
} from '../../../../../api/inventoryLookupsApi'
import type { DictionaryItem, InventoryProductLookup } from '../../../../../api/domainTypes'
import { Combobox } from '../../../../data/Combobox'
import { Drawer } from '../../../../feedback/Drawer'
import { Icon } from '../../../../primitives/Icon'
import { Select } from '../../../../primitives/Select'
import {
  receiptLineColorRequired,
  receiptLineSizeRequired,
} from '../../shared/receiptLineVariantRules'

type Props = {
  docId: string
  clientId: string
  open: boolean
  onClose: () => void
  onAdded: () => void
}

/**
 * Drawer для добавления строки в существующий документ поступления (draft/planned views).
 */
export function AddLineDrawer({ docId, clientId, open, onClose, onAdded }: Props) {
  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [productId, setProductId] = useState('')
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [colorId, setColorId] = useState('')
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [sizeId, setSizeId] = useState('')
  const [qty, setQty] = useState(0)
  const [qtyDraft, setQtyDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && clientId) {
      getInventoryProducts(clientId).then(setProducts)
    }
  }, [open, clientId])

  const selectedProduct = products.find((p) => p.id === productId)

  useEffect(() => {
    setColorId('')
    setColors([])
    setSizeId('')
    setSizes([])
    if (selectedProduct?.sku) {
      getInventoryColorsForProductSku(selectedProduct.sku).then(setColors)
    }
  }, [productId, selectedProduct?.sku])

  useEffect(() => {
    setSizeId('')
    setSizes([])
    if (selectedProduct?.sku && colorId) {
      getInventorySizesForProductSkuAndColor(selectedProduct.sku, colorId).then(setSizes)
    }
  }, [colorId, selectedProduct?.sku])

  const needsColor = receiptLineColorRequired(selectedProduct)
  const needsSize = receiptLineSizeRequired(selectedProduct)
  const canPickSize = sizes.length > 0

  async function handleAdd() {
    if (!selectedProduct) { setError('Выберите товар'); return }
    if (needsColor && !colorId) { setError('Выберите цвет'); return }
    if (needsSize && !sizeId) { setError('Выберите размер — он обязателен для этого типа товара'); return }
    if (qty < 1) { setError('Количество должно быть не меньше 1'); return }
    setError('')
    setSaving(true)
    try {
      const selectedColor = colors.find((c) => c.id === colorId)
      const selectedSize = sizes.find((s) => s.id === sizeId)
      await addReceiptLine(docId, {
        product_id: selectedProduct.id,
        product_name: selectedProduct.name,
        product_sku: selectedProduct.sku,
        color_id: colorId || null,
        color_name: selectedColor?.name ?? null,
        size_id: sizeId || null,
        size_name: selectedSize?.name ?? null,
        planned_qty: qty,
      })
      onAdded()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Добавить строку"
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!productId || (needsColor && !colorId) || qty < 1 || saving} onClick={handleAdd}>
            <Icon name="plus" size={13} />Добавить
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
          options={products.map((p) => ({ value: p.id, label: p.name, sub: p.sku }))}
          onChange={(v) => setProductId(String(v ?? ''))}
          prefix="search"
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14, alignItems: 'start' }}>
        <div>
          <label className="field-label">
            <span>Цвет{needsColor && <span style={{ color: 'var(--c-danger)', marginLeft: 3 }}>*</span>}</span>
          </label>
          <Select
            value={colorId}
            placeholder={colors.length > 0 ? 'Выберите цвет' : '—'}
            options={colors.map((c) => ({ value: c.id, label: c.name }))}
            prefix="palette"
            onChange={setColorId}
            disabled={!selectedProduct || colors.length === 0}
          />
        </div>
        <div>
          <label className="field-label">
            <span>Размер{needsSize && <span style={{ color: 'var(--c-danger)', marginLeft: 3 }}>*</span>}</span>
            {!needsSize && selectedProduct && <span className="text-xs faint">не обязательно</span>}
          </label>
          <Select
            value={sizeId}
            placeholder={canPickSize ? 'Выберите размер' : '—'}
            options={sizes.map((s) => ({ value: s.id, label: s.name }))}
            prefix="ruler"
            onChange={setSizeId}
            disabled={!canPickSize}
          />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <label className="field-label">
          <span>Плановое количество <span style={{ color: 'var(--c-danger)' }}>*</span></span>
        </label>
        <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 30, width: 160, background: 'var(--c-bg-elev)' }}>
          <button
            className="btn ghost icon sm"
            style={{ height: 28, width: 26, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
            onClick={() => { const n = Math.max(1, qty - 1); setQty(n); setQtyDraft(String(n)) }}
          >
            <Icon name="minus" size={11} />
          </button>
          <input
            inputMode="numeric"
            value={qtyDraft}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, '')
              setQtyDraft(raw)
              if (raw !== '') setQty(parseInt(raw, 10))
            }}
            style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', background: 'transparent', minWidth: 0 }}
          />
          <button
            className="btn ghost icon sm"
            style={{ height: 28, width: 26, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
            onClick={() => { const n = qty + 1; setQty(n); setQtyDraft(String(n)) }}
          >
            <Icon name="plus" size={11} />
          </button>
        </div>
      </div>
    </Drawer>
  )
}
