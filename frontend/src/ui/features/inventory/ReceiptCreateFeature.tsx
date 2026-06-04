import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  createReceipt,
  advanceReceiptStatus,
} from '../../../api/receiptsApi'
import { linkTripReceipts } from '../../../api/tripsApi'
import type { ReceiptLineInput } from '../../../api/receiptsApi'
import {
  getInventoryProducts,
  getInventoryColorsForProductSku,
  getInventorySizesForProductSkuAndColor,
} from '../../../api/inventoryLookupsApi'
import type { DictionaryItem, InventoryProductLookup } from '../../../api/domainTypes'
import { Combobox } from '../../data/Combobox'
import { FormPage } from '../../layouts/FormPage'
import { Card, CardHead, CardBody } from '../../primitives/Card'
import { Alert } from '../../primitives/Alert'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { Select } from '../../primitives/Select'
import { Drawer } from '../../feedback/Drawer'
import { DatePicker } from '../../primitives/DatePicker'
import { Table, Td } from '../../data/Table'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canViewCosts } from '../../../utils/access'
import { NumberStep } from './shared/NumberStep'
import {
  receiptLineColorRequired,
  receiptLineSizeRequired,
} from './shared/receiptLineVariantRules'
import { ReceiptStepper } from './ReceiptStepper'

type DraftLine = ReceiptLineInput & { _id: number }

function genId() {
  return Math.floor(Math.random() * 1e9)
}

export function ReceiptCreateFeature() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tripParam = searchParams.get('trip')
  const returnToParam = searchParams.get('returnTo')
  const backTarget = tripParam ? `/logistics/trips/${tripParam}` : (returnToParam || '/inventory/receipts')

  const [clientId, setClientId] = useState('')
  const [arrivalDate, setArrivalDate] = useState('')
  const [comment, setComment] = useState('')
  const [logisticsCost, setLogisticsCost] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showAddLine, setShowAddLine] = useState(false)
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const { clients: clientsAll } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const clients: DictionaryItem[] = clientsAll.filter((c) => c.is_active && !c.is_deleted)

  const totalQty = lines.reduce((s, l) => s + l.planned_qty, 0)
  const totalSku = new Set(lines.map((l) => l.product_sku)).size
  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0

  const readyChecks = [
    { ok: !!clientId, label: 'Клиент указан', error: 'Не выбран клиент' },
    { ok: !!arrivalDate, label: 'Дата прибытия (план) указана', error: 'Не указана дата прибытия (план)' },
    ...(showCosts ? [{ ok: logisticsCostFilled, label: 'Стоимость логистики для клиента указана', error: 'Не указана стоимость логистики для клиента' }] : []),
    { ok: lines.length > 0, label: `Строк добавлено: ${lines.length}`, error: 'Не добавлено ни одной строки' },
    { ok: lines.length > 0 && lines.every((l) => l.planned_qty >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
  ]

  const blockReasons = readyChecks.filter((c) => !c.ok).map((c) => c.error)

  async function handleSave() {
    if (!clientId) { setError('Укажите клиента'); return }
    setError('')
    setSaving(true)
    try {
      const res = await createReceipt({
        client_id: clientId,
        arrival_date: arrivalDate || null,
        comment: comment.trim() || null,
        ...(showCosts ? { logistics_cost: logisticsCostFilled ? logisticsCostNumber : null } : {}),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        lines: lines.map(({ _id, ...l }) => l),
      })
      const docId = res.message
      await advanceReceiptStatus(docId)
      if (tripParam) {
        // Создано из рейса — привязываем и возвращаемся к рейсу.
        try { await linkTripReceipts(tripParam, [docId]) } catch { /* поступление создано; привязку можно повторить из рейса */ }
        navigate(`/logistics/trips/${tripParam}`)
      } else if (returnToParam) {
        navigate(returnToParam)
      } else {
        navigate(`/inventory/receipts/${docId}`)
      }
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

      backTo={backTarget}
      actions={
        <div className="detail-actions">
          <div className="detail-actions-row">
            <button className="btn" onClick={() => navigate(backTarget)} disabled={saving}>
              Отмена
            </button>
            <button
              className="btn primary"
              onClick={() => { if (blockReasons.length > 0) { setShowBlockReasons(true) } else { void handleSave() } }}
              disabled={saving}
            >
              <Icon name="check" size={14} />Запланировать поступление
            </button>
          </div>
          {showBlockReasons && blockReasons.length > 0 && (
            <div className="block-reasons">
              {blockReasons.map((r, i) => <div key={i}>· {r}</div>)}
            </div>
          )}
        </div>
      }
    >
      <ReceiptStepper status="draft" style={{ marginTop: -10 }} />

      {error && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{error}</Alert>
      )}

      <div className="split-300">
        {/* Левая колонка */}
        <div className="col gap-16">
          {/* Основная информация */}
          <Card>
            <CardHead>
              <Icon name="file" size={15} className="ic-accent" />
              <span className="card-head-title">Основная информация</span>
            </CardHead>
            <CardBody>
              <div className="form-grid-2">
                <div>
                  <label className="field-label">
                    <span>Клиент <span style={{ color: 'var(--c-danger)' }}>*</span></span>
                  </label>
                  <Combobox
                    value={clientId}
                    placeholder="Поиск клиента…"
                    options={clients.map((c) => ({ value: c.id, label: c.name }))}
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
                    <span>Дата прибытия (план) <span style={{ color: 'var(--c-danger)' }}>*</span></span>
                  </label>
                  <DatePicker value={arrivalDate} onChange={setArrivalDate} />
                </div>
                {showCosts && (
                  <div>
                    <label className="field-label">
                      <span>Стоимость логистики для клиента, ₽ <span style={{ color: 'var(--c-danger)' }}>*</span></span>
                    </label>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={logisticsCost}
                      onChange={(e) => setLogisticsCost(e.target.value)}
                    />
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="field-label">
                    <span>Комментарий</span>
                    <span className="text-xs faint">не обязательно</span>
                  </label>
                  <textarea
                    className="input"
                    rows={3}
                    placeholder="Примечание для команды склада"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    style={{ resize: 'vertical', minHeight: 76 }}
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Товары */}
          <Card>
            <CardHead>
              <Icon name="boxes" size={15} className="ic-accent" />
              <span className="card-head-title">Товары</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{lines.length}</Badge>
              <div className="flex-1" />
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
                    <th>Товар</th>
                    <th style={{ width: 130, textAlign: 'right' }}>План</th>
                    <th style={{ width: 56 }}>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l._id}>
                      <Td>
                        <div style={{ fontWeight: 450 }}>{l.product_name}</div>
                        <div className="t-sub mono">
                          {[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td className="num" style={{ color: 'var(--c-text-muted)' }}>
                        <NumberStep
                          value={l.planned_qty}
                          onChange={(v) => handleUpdateQty(l._id, v)}
                          width={100}
                        />
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                          <button className="btn ghost icon sm" onClick={() => handleRemoveLine(l._id)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ padding: 0 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 24, padding: '10px 14px',
                        background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)', fontSize: 12.5,
                      }}>
                        <span style={{ fontWeight: 700 }}>Итого</span>
                        <span style={{ color: 'var(--c-text-subtle)' }}>{totalSku} SKU</span>
                        <span style={{ color: 'var(--c-text-subtle)' }}>
                          План <b className="mono" style={{ color: 'var(--c-text)' }}>{totalQty}</b>
                        </span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </Table>
            )}
          </Card>

        </div>

        {/* Правая колонка: чеклист + превью операций + итого */}
        <div className="col gap-16" style={{ position: 'sticky', top: 16 }}>
          {/* Готовность */}
          <Card>
            <CardHead>
              <Icon name="check" size={15} className="ic-success" />
              <span className="card-head-title">Готовность</span>
            </CardHead>
            <div className="readiness-list">
              {readyChecks.map((c, i) => (
                <div key={i} className="readiness-row">
                  {c.ok ? (
                    <div className="readiness-dot ok">
                      <Icon name="check" size={10} />
                    </div>
                  ) : (
                    <div className="readiness-dot pending" />
                  )}
                  <span className={`readiness-label ${c.ok ? 'ok' : 'pending'}`}>{c.label}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Предпросмотр операций */}
          <Card>
            <CardHead>
              <Icon name="layers" size={15} className="ic-accent" />
              <span className="card-head-title">Будут зафиксированы</span>
              <span className="right text-xs subtle">
                {1 + lines.length} опер.
              </span>
            </CardHead>
            <div style={{ padding: '4px 0 8px' }}>
              <OpPreviewItem icon="plus" tone="accent" title="Создание документа" sub="черновик · клиент, дата" />
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
                <div className="text-xs subtle" style={{ padding: '3px 14px 6px 46px' }}>
                  и ещё {lines.length - 4} строк…
                </div>
              )}
            </div>
          </Card>

          {/* Итого */}
          <Card>
            <CardHead>
              <Icon name="chart" size={15} className="ic-accent" />
              <span className="card-head-title">Итого</span>
            </CardHead>
            <div className="totals-grid">
              <span className="key">SKU</span>
              <span className="val mono">{totalSku}</span>
              <span className="key">Строк</span>
              <span className="val mono">{lines.length}</span>
              <span className="key">План, шт</span>
              <span className="val mono" style={{ fontWeight: 500, fontSize: 14 }}>{totalQty}</span>
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
  const [qty, setQty] = useState(0)
  const [qtyDraft, setQtyDraft] = useState('')

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
    if (needsColor && !colorId) return
    if (needsSize && !sizeId) return
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

  const needsColor = receiptLineColorRequired(selectedProduct)
  const needsSize = receiptLineSizeRequired(selectedProduct)
  const canPickSize = sizes.length > 0

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
            disabled={!productId || (needsColor && !colorId) || qty < 1 || (needsSize && !sizeId)}
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
            style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0 }}
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
