import { useEffect, useState } from 'react'
import { createStockEntry } from '../../../../api/balancesApi'
import type { StockEntryLine } from '../../../../api/balancesApi'
import {
  getInventoryColorsForProduct,
  getInventoryProducts,
  getInventorySizesForProductAndColor,
} from '../../../../api/inventoryLookupsApi'
import type { DictionaryItem, InventoryProductLookup } from '../../../../api/domainTypes'
import { Combobox } from '../../../data/Combobox'
import { Drawer } from '../../../feedback/Drawer'
import { Icon } from '../../../primitives/Icon'
import { Select } from '../../../primitives/Select'
import { useLookups } from '../../../../hooks/useLookups'
import {
  receiptLineColorRequired,
  receiptLineSizeRequired,
} from '../shared/receiptLineVariantRules'

type Props = {
  open: boolean
  onClose: () => void
  onDone: () => void
}

type DraftLine = StockEntryLine & { zone_name: string }

/** Историческое заведение остатков — то, что лежало на складе до системы.
 *  Без документа/маршрута: позиции пишутся движением intake→storage сразу в остатки. */
export function StockEntryDrawer({ open, onClose, onDone }: Props) {
  const { clients, unloadingZones } = useLookups()
  const zones: DictionaryItem[] = unloadingZones.filter((z) => z.is_active && !z.is_deleted)

  const [clientId, setClientId] = useState('')
  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [productId, setProductId] = useState('')
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [colorId, setColorId] = useState('')
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [sizeId, setSizeId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [quality, setQuality] = useState<'good' | 'defect'>('good')
  const [qtyDraft, setQtyDraft] = useState('')

  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && clientId) getInventoryProducts(clientId).then(setProducts)
    else setProducts([])
    setProductId('')
  }, [open, clientId])

  const selectedProduct = products.find((p) => p.id === productId)

  useEffect(() => {
    setColorId(''); setColors([]); setSizeId(''); setSizes([])
    if (selectedProduct) getInventoryColorsForProduct(selectedProduct.id).then(setColors)
  }, [productId, selectedProduct?.id])

  useEffect(() => {
    setSizeId(''); setSizes([])
    if (selectedProduct && colorId) getInventorySizesForProductAndColor(selectedProduct.id, colorId).then(setSizes)
  }, [colorId, selectedProduct?.id])

  const needsColor = receiptLineColorRequired(selectedProduct)
  const needsSize = receiptLineSizeRequired(selectedProduct)
  const qty = qtyDraft === '' ? 0 : parseInt(qtyDraft, 10)

  function addLine() {
    if (!selectedProduct) { setError('Выберите товар'); return }
    if (needsColor && !colorId) { setError('Выберите цвет'); return }
    if (needsSize && !sizeId) { setError('Выберите размер'); return }
    if (!zoneId) { setError('Выберите место хранения'); return }
    if (qty < 1) { setError('Количество должно быть не меньше 1'); return }
    setError('')
    const color = colors.find((c) => c.id === colorId)
    const size = sizes.find((s) => s.id === sizeId)
    const zone = zones.find((z) => z.id === zoneId)
    setLines((prev) => [...prev, {
      product_id: selectedProduct.id, product_name: selectedProduct.name, product_sku: selectedProduct.sku,
      color_id: colorId || null, color_name: color?.name ?? null,
      size_id: sizeId || null, size_name: size?.name ?? null,
      zone_id: zoneId, zone_name: zone?.name ?? '', quality, qty,
    }])
    setProductId(''); setColorId(''); setSizeId(''); setQtyDraft('')
  }

  async function submit() {
    if (!clientId) { setError('Выберите клиента'); return }
    if (lines.length === 0) { setError('Добавьте хотя бы одну позицию'); return }
    setError(''); setSaving(true)
    try {
      await createStockEntry({
        client_id: clientId,
        lines: lines.map(({ zone_name: _z, ...l }) => l),
      })
      setLines([]); setClientId('')
      onDone()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Завести остаток"
      subtitle="Историческое — то, что лежало на складе до системы"
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!clientId || lines.length === 0 || saving} onClick={submit}>
            <Icon name="check" size={13} />Завести {lines.length > 0 ? `(${lines.length})` : ''}
          </button>
        </>
      }
    >
      {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 10 }}>{error}</div>}

      <div>
        <label className="field-label"><span>Клиент <span style={{ color: 'var(--c-danger)' }}>*</span></span></label>
        <Combobox
          value={clientId}
          placeholder="Выберите клиента…"
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(v) => { setClientId(String(v ?? '')); setLines([]) }}
          prefix="search"
        />
      </div>

      <div style={{ marginTop: 16, padding: 14, border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', background: 'var(--c-bg-sunken)' }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>Позиция</div>
        <Combobox
          value={productId}
          placeholder={clientId ? 'Поиск по SKU или названию…' : 'Сначала выберите клиента'}
          options={products.map((p) => ({ value: p.id, label: p.name, sub: p.sku_pending ? 'Без SKU' : p.sku }))}
          onChange={(v) => setProductId(String(v ?? ''))}
          prefix="search"
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Select
            value={colorId} placeholder={colors.length ? 'Цвет' : '—'} prefix="palette"
            options={colors.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setColorId} disabled={!selectedProduct || colors.length === 0}
          />
          <Select
            value={sizeId} placeholder={sizes.length ? 'Размер' : '—'} prefix="ruler"
            options={sizes.map((s) => ({ value: s.id, label: s.name }))}
            onChange={setSizeId} disabled={sizes.length === 0}
          />
          <Select
            value={zoneId} placeholder="Место хранения" prefix="box"
            options={zones.map((z) => ({ value: z.id, label: z.name }))}
            onChange={setZoneId} disabled={!selectedProduct}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="seg" style={{ display: 'inline-flex', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <button className={`tab ${quality === 'good' ? 'active' : ''}`} style={{ padding: '0 10px' }} onClick={() => setQuality('good')}>Годный</button>
              <button className={`tab ${quality === 'defect' ? 'active' : ''}`} style={{ padding: '0 10px' }} onClick={() => setQuality('defect')}>Брак</button>
            </div>
            <input
              className="input sm num" inputMode="numeric" placeholder="Кол-во" value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value.replace(/\D/g, ''))}
              style={{ width: 90 }}
            />
          </div>
        </div>
        <button className="btn sm" style={{ marginTop: 12 }} onClick={addLine} disabled={!selectedProduct}>
          <Icon name="plus" size={12} />Добавить позицию
        </button>
      </div>

      {lines.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)', fontSize: 12.5 }}>
              <span className="mono" style={{ fontWeight: 600 }}>{l.product_sku}</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>
                {[l.color_name, l.size_name].filter(Boolean).join(' · ') || '—'}
              </span>
              <span style={{ color: 'var(--c-text-subtle)' }}>· {l.zone_name}</span>
              {l.quality === 'defect' && <span style={{ color: 'var(--c-warning)' }}>· брак</span>}
              <span className="num" style={{ marginLeft: 'auto', fontWeight: 700 }}>{l.qty} шт</span>
              <button className="btn ghost icon sm" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
