import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createReceipt,
  advanceReceiptStatus,
  arriveReceipt,
} from '../../../api/receiptsApi'
import type { ReceiptLineInput } from '../../../api/receiptsApi'
import {
  getInventoryClients,
  getInventorySuppliers,
  getInventoryUnloadingZones,
  getInventoryProducts,
  getInventoryColorsForProductSku,
  getInventorySizesForProductSkuAndColor,
} from '../../../api/inventoryLookupsApi'
import type { DictionaryItem, InventoryProductLookup } from '../../../api/domainTypes'
import { Combobox } from '../../data/Combobox'
import { FormPage } from '../../layouts/FormPage'
import { Card, CardHead, CardBody } from '../../primitives/Card'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { Select } from '../../primitives/Select'
import { Drawer } from '../../feedback/Drawer'
import { DatePicker } from '../../primitives/DatePicker'
import { Table, Td } from '../../data/Table'
import { ReceiptStepper } from './ReceiptStepper'

type DraftLine = ReceiptLineInput & { _id: number }

function genId() {
  return Math.floor(Math.random() * 1e9)
}

export function ReceiptCreateFeature() {
  const navigate = useNavigate()

  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [suppliers, setSuppliers] = useState<DictionaryItem[]>([])
  const [unloadingZones, setUnloadingZones] = useState<DictionaryItem[]>([])
  const [clientId, setClientId] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [arrivalDate, setArrivalDate] = useState('')
  const [ttn, setTtn] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [logisticsCost, setLogisticsCost] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showAddLine, setShowAddLine] = useState(false)
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  useEffect(() => {
    getInventoryClients().then((res) => setClients(res.filter((c) => c.is_active && !c.is_deleted)))
    getInventorySuppliers().then((res) => setSuppliers(res.filter((s) => s.is_active && !s.is_deleted)))
    getInventoryUnloadingZones().then((res) => setUnloadingZones(res.filter((z) => z.is_active && !z.is_deleted)))
  }, [])

  const totalQty = lines.reduce((s, l) => s + l.planned_qty, 0)
  const totalSku = new Set(lines.map((l) => l.product_sku)).size

  const readyChecks = [
    { ok: !!clientId, label: 'Клиент указан', error: 'Не выбран клиент' },
    { ok: !!arrivalDate, label: 'Дата прибытия указана', error: 'Не указана дата прибытия' },
    { ok: lines.length > 0, label: `Строк добавлено: ${lines.length}`, error: 'Не добавлено ни одной строки' },
    { ok: lines.length > 0 && lines.every((l) => l.planned_qty >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
  ]

  const blockReasons = readyChecks.filter((c) => !c.ok).map((c) => c.error)

  async function handleSave(mode: 'plan' | 'arrive') {
    if (!clientId) { setError('Укажите клиента'); return }
    setError('')
    setSaving(true)
    try {
      const selectedZone = unloadingZones.find((z) => z.id === zoneId)
      const res = await createReceipt({
        client_id: clientId,
        supplier_name: supplierName.trim() || null,
        arrival_date: arrivalDate || null,
        ttn: ttn.trim() || null,
        zone_id: zoneId || null,
        zone_name: selectedZone?.name ?? null,
        logistics_cost: logisticsCost ? parseFloat(logisticsCost) : null,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        lines: lines.map(({ _id, ...l }) => l),
      })
      const docId = res.message
      if (mode === 'plan') {
        await advanceReceiptStatus(docId)
      } else {
        await arriveReceipt(docId)
      }
      navigate(`/inventory/receipts/${docId}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  function handleRemoveLine(id: number) {
    setLines((ls) => ls.filter((l) => l._id !== id))
  }

  function handleUpdateQty(id: number, qty: number) {
    setLines((ls) => ls.map((l) => l._id === id ? { ...l, planned_qty: qty } : l))
  }

  return (
    <FormPage
      title="Новое поступление"

      backTo="/inventory/receipts"
      actions={
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => navigate('/inventory/receipts')} disabled={saving}>
              Отмена
            </button>
            <button
              className="btn primary"
              onClick={() => { if (blockReasons.length > 0) { setShowBlockReasons(true) } else { void handleSave('plan') } }}
              disabled={saving}
            >
              <Icon name="check" size={14} />Запланировать поступление
            </button>
          </div>
          {showBlockReasons && blockReasons.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--c-danger)', textAlign: 'right', lineHeight: 1.5 }}>
              {blockReasons.map((r, i) => <div key={i}>· {r}</div>)}
            </div>
          )}
        </div>
      }
    >
      <ReceiptStepper status="draft" style={{ marginTop: -10 }} />

      {error && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'color-mix(in oklab, var(--c-danger) 10%, transparent)',
          border: '1px solid color-mix(in oklab, var(--c-danger) 30%, transparent)',
          borderRadius: 'var(--r-md)', color: 'var(--c-danger)', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        {/* Левая колонка */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Основная информация */}
          <Card>
            <CardHead>
              <Icon name="file" size={15} style={{ color: 'var(--c-accent)' }} />
              <span className="card-head-title">Основная информация</span>
            </CardHead>
            <CardBody>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label className="field-label">
                    <span>Клиент <span style={{ color: 'var(--c-danger)' }}>*</span></span>
                  </label>
                  <Combobox
                    value={clientId}
                    placeholder="Поиск клиента…"
                    options={clients.map((c) => ({ value: c.id, label: c.name }))}
                    prefix="user"
                    onChange={(v) => setClientId(String(v ?? ''))}
                    disabled={lines.length > 0}
                  />
                  {lines.length > 0 && (
                    <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 4 }}>
                      Удалите все строки, чтобы сменить клиента
                    </div>
                  )}
                </div>
                <div>
                  <label className="field-label">
                    <span>Поставщик</span>
                  </label>
                  <Combobox
                    value={suppliers.find((s) => s.name === supplierName)?.id ?? ''}
                    placeholder="Выберите поставщика"
                    options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                    onChange={(v) => {
                      const found = suppliers.find((s) => s.id === String(v ?? ''))
                      setSupplierName(found?.name ?? '')
                    }}
                    clearable
                    prefix="user"
                  />
                </div>
                <div>
                  <label className="field-label">
                    <span>Дата прибытия (плановая) <span style={{ color: 'var(--c-danger)' }}>*</span></span>
                  </label>
                  <DatePicker value={arrivalDate} onChange={setArrivalDate} />
                </div>
                <div>
                  <label className="field-label">
                    <span>Номер ТТН</span>
                  </label>
                  <input
                    className="input"
                    placeholder="TTN-00001"
                    value={ttn}
                    onChange={(e) => setTtn(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">
                    <span>Зона разгрузки</span>
                  </label>
                  <Combobox
                    value={zoneId}
                    placeholder="Выберите зону…"
                    options={unloadingZones.map((z) => ({ value: z.id, label: z.name }))}
                    prefix="map"
                    onChange={(v) => setZoneId(String(v ?? ''))}
                    clearable
                  />
                </div>
                <div>
                  <label className="field-label">
                    <span>Стоимость логистики, ₽</span>
                  </label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={logisticsCost}
                    onChange={(e) => setLogisticsCost(e.target.value)}
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Товары */}
          <Card>
            <CardHead>
              <Icon name="boxes" size={15} style={{ color: 'var(--c-accent)' }} />
              <span className="card-head-title">Товары</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{lines.length}</Badge>
              <div style={{ flex: 1 }} />
              <button
                className="btn sm primary"
                onClick={() => setShowAddLine(true)}
                disabled={!clientId}
              >
                <Icon name="plus" size={12} />Добавить строку
              </button>
            </CardHead>
            {lines.length === 0 ? (
              <div className="empty">
                <div className="empty-illust" />
                <div style={{ fontSize: 14, fontWeight: 500 }}>Нет строк</div>
                <div className="text-sm muted mt-8">
                  {clientId ? 'Нажмите «Добавить строку» для выбора товара' : 'Сначала выберите клиента'}
                </div>
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>#</th>
                    <th>Товар · SKU</th>
                    <th style={{ width: 110 }}>Цвет</th>
                    <th style={{ width: 80 }}>Размер</th>
                    <th style={{ width: 148 }}>План, шт</th>
                    <th style={{ width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l._id}>
                      <Td><span className="mono" style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>{i + 1}</span></Td>
                      <Td>
                        <div style={{ fontWeight: 450 }}>{l.product_name}</div>
                        <div className="t-sub mono">{l.product_sku}</div>
                      </Td>
                      <Td>{l.color_name ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</Td>
                      <Td className="mono">{l.size_name ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</Td>
                      <Td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 26, width: 120, background: 'var(--c-bg-elev)' }}>
                          <button
                            className="btn ghost icon sm"
                            style={{ height: 24, width: 24, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
                            onClick={() => handleUpdateQty(l._id, Math.max(1, l.planned_qty - 1))}
                          >
                            <Icon name="minus" size={10} />
                          </button>
                          <input
                            inputMode="numeric"
                            value={l.planned_qty}
                            onChange={(e) => handleUpdateQty(l._id, Math.max(1, parseInt(e.target.value.replace(/\D/g, '')) || 1))}
                            style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0 }}
                          />
                          <button
                            className="btn ghost icon sm"
                            style={{ height: 24, width: 24, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
                            onClick={() => handleUpdateQty(l._id, l.planned_qty + 1)}
                          >
                            <Icon name="plus" size={10} />
                          </button>
                        </div>
                      </Td>
                      <Td>
                        <button className="btn ghost icon sm" onClick={() => handleRemoveLine(l._id)}>
                          <Icon name="trash" size={13} />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--c-bg-sunken)' }}>
                    <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                      Итого: {totalSku} SKU
                    </td>
                    <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>
                      {totalQty}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </Table>
            )}
          </Card>

        </div>

        {/* Правая колонка: чеклист + превью операций + итого */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 16 }}>
          {/* Готовность */}
          <Card>
            <CardHead>
              <Icon name="check" size={15} style={{ color: 'var(--c-success)' }} />
              <span className="card-head-title">Готовность</span>
            </CardHead>
            <div style={{ padding: '4px 0' }}>
              {readyChecks.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13 }}>
                  {c.ok ? (
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: 'var(--c-success-bg)', color: 'var(--c-success)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Icon name="check" size={10} />
                    </div>
                  ) : (
                    <div style={{
                      width: 16, height: 16, borderRadius: '50%',
                      border: '1.5px dashed var(--c-text-faint)',
                      flexShrink: 0,
                    }} />
                  )}
                  <span style={{ color: c.ok ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{c.label}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Предпросмотр операций */}
          <Card>
            <CardHead>
              <Icon name="layers" size={15} style={{ color: 'var(--c-accent)' }} />
              <span className="card-head-title">Будут зафиксированы</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                {1 + lines.length} опер.
              </span>
            </CardHead>
            <div style={{ padding: '4px 0 8px' }}>
              <OpPreviewItem icon="plus" tone="accent" title="Создание документа" sub="черновик · клиент, дата, ТТН, зона" />
              {lines.slice(0, 4).map((l) => (
                <OpPreviewItem
                  key={l._id}
                  icon="plus"
                  tone=""
                  title="Добавление строки"
                  sub={[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ') + ` — ${l.planned_qty} шт`}
                />
              ))}
              {lines.length > 4 && (
                <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', padding: '3px 14px 6px 46px' }}>
                  и ещё {lines.length - 4} строк…
                </div>
              )}
            </div>
          </Card>

          {/* Итого */}
          <Card>
            <CardHead>
              <Icon name="chart" size={15} style={{ color: 'var(--c-accent)' }} />
              <span className="card-head-title">Итого</span>
            </CardHead>
            <div style={{ padding: '14px 16px', display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 10, columnGap: 12, fontSize: 13 }}>
              <span style={{ color: 'var(--c-text-muted)' }}>SKU</span>
              <span style={{ textAlign: 'right' }} className="mono">{totalSku}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>Строк</span>
              <span style={{ textAlign: 'right' }} className="mono">{lines.length}</span>
              <span style={{ color: 'var(--c-text-muted)' }}>План, шт</span>
              <span style={{ textAlign: 'right', fontWeight: 500, fontSize: 14 }} className="mono">{totalQty}</span>
            </div>
          </Card>
        </div>
      </div>

      {/* Drawer: добавить строку */}
      <AddLineDrawer
        key={showAddLine ? 'open' : 'closed'}
        open={showAddLine}
        clientId={clientId}
        onClose={() => setShowAddLine(false)}
        onAdd={(line) => {
          setLines((ls) => [...ls, { ...line, _id: genId() }])
          setShowAddLine(false)
        }}
      />
    </FormPage>
  )
}

function OpPreviewItem({ icon, tone, title, sub }: { icon: string; tone: string; title: string; sub: string }) {
  const bgMap: Record<string, string> = {
    accent: 'var(--c-accent-bg)',
    success: 'var(--c-success-bg)',
    '': 'var(--c-bg-sunken)',
  }
  const borderMap: Record<string, string> = {
    accent: 'var(--c-accent-border)',
    success: 'color-mix(in oklab, var(--c-success) 35%, transparent)',
    '': 'var(--c-border)',
  }
  const colorMap: Record<string, string> = {
    accent: 'var(--c-accent)',
    success: 'var(--c-success)',
    '': 'var(--c-text-muted)',
  }
  return (
    <div style={{ display: 'flex', gap: 10, padding: '6px 14px', alignItems: 'flex-start' }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        background: bgMap[tone] ?? bgMap[''],
        border: `1px solid ${borderMap[tone] ?? borderMap['']}`,
        color: colorMap[tone] ?? colorMap[''],
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon name={icon as never} size={11} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      </div>
    </div>
  )
}

function AddLineDrawer({
  open,
  clientId,
  onClose,
  onAdd,
}: {
  open: boolean
  clientId: string
  onClose: () => void
  onAdd: (line: ReceiptLineInput) => void
}) {
  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [productId, setProductId] = useState('')
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [colorId, setColorId] = useState('')
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [sizeId, setSizeId] = useState('')
  const [qty, setQty] = useState(10)

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

  function handleAdd() {
    if (!selectedProduct || qty < 1) return
    const selectedColor = colors.find((c) => c.id === colorId)
    const selectedSize = sizes.find((s) => s.id === sizeId)
    onAdd({
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      product_sku: selectedProduct.sku,
      color_id: colorId || null,
      color_name: selectedColor?.name ?? null,
      size_id: sizeId || null,
      size_name: selectedSize?.name ?? null,
      planned_qty: qty,
    })
  }

  const needsColor = selectedProduct?.requires_color ?? false
  const canPickSize = !!colorId && sizes.length > 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Добавить строку"

      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>Отмена</button>
          <button
            className="btn primary"
            disabled={!productId || qty < 1}
            onClick={handleAdd}
          >
            <Icon name="plus" size={13} />Добавить
          </button>
        </>
      }
    >
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
            {!needsColor && <span className="text-xs faint">не обязательно</span>}
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
            <span>Размер</span>
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
            onClick={() => setQty((q) => Math.max(1, q - 1))}
          >
            <Icon name="minus" size={11} />
          </button>
          <input
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value.replace(/\D/g, '')) || 1))}
            style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0 }}
          />
          <button
            className="btn ghost icon sm"
            style={{ height: 28, width: 26, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
            onClick={() => setQty((q) => q + 1)}
          >
            <Icon name="plus" size={11} />
          </button>
        </div>
      </div>
    </Drawer>
  )
}
