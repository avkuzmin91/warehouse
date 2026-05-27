import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getReceipt,
  recordReceiptOp,
  advanceReceiptStatus,
  arriveReceipt,
  cancelReceipt,
  reopenReceipt,
  completeReceiptLine,
  reopenReceiptLine,
  addReceiptLine,
  updateReceipt,
  updateReceiptLine,
  deleteReceiptLine,
  RECEIPT_STATUS_LABELS,
  RECEIPT_OP_LABELS,
  receiptStatusTone,
} from '../../../api/receiptsApi'
import type { ReceiptDetail, ReceiptLine, ReceiptOp } from '../../../api/receiptsApi'
import {
  getInventoryClients,
  getInventorySuppliers,
  getInventoryUnloadingZones,
  getInventoryProducts,
  getInventoryColorsForProductSku,
  getInventorySizesForProductSkuAndColor,
} from '../../../api/inventoryLookupsApi'
import type { DictionaryItem, InventoryProductLookup } from '../../../api/domainTypes'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { Select } from '../../primitives/Select'
import { Card, CardHead, CardBody } from '../../primitives/Card'
import { Avatar, getInitials } from '../../primitives/Avatar'
import { Table, Td } from '../../data/Table'
import { FilterChip } from '../../data/FiltersBar'
import { Drawer } from '../../feedback/Drawer'
import { Combobox } from '../../data/Combobox'
import { DatePicker } from '../../primitives/DatePicker'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { ReceiptStepper } from './ReceiptStepper'

interface Props {
  docId: string
}

const OP_TONES: Record<string, string> = {
  doc_create: 'accent',
  doc_update: '',
  line_add: 'accent',
  line_update: '',
  line_delete: 'danger',
  plan_fix: 'info',
  arrival_fix: 'info',
  receiving: 'success',
  defect_fix: 'warning',
  qc_complete: 'success',
  cancel: 'danger',
  line_qc_complete: 'success',
  line_qc_reopen: 'info',
  receiving_correction: 'warning',
  defect_correction: 'warning',
}

const OP_ICONS: Record<string, string> = {
  doc_create: 'plus',
  doc_update: 'edit',
  line_add: 'plus',
  line_update: 'edit',
  line_delete: 'trash',
  plan_fix: 'arrowRight',
  arrival_fix: 'check',
  receiving: 'check',
  defect_fix: 'alert',
  qc_complete: 'shield',
  cancel: 'x',
  line_qc_complete: 'check',
  line_qc_reopen: 'edit',
  receiving_correction: 'edit',
  defect_correction: 'edit',
}

function fmtDateTime(s: string) {
  const d = new Date(s)
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU')
}

// ─── Draft view (mirrors /new form) ──────────────────────────────────────────

function DraftView({
  docId,
  detail,
  onReload,
  onAdvance,
  advancing,
}: {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onAdvance: () => void
  advancing: boolean
}) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { doc, lines } = detail

  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [suppliers, setSuppliers] = useState<DictionaryItem[]>([])
  const [unloadingZones, setUnloadingZones] = useState<DictionaryItem[]>([])
  const [clientId, setClientId] = useState(doc.client_id)
  const [supplierName, setSupplierName] = useState(doc.supplier_name ?? '')
  const [arrivalDate, setArrivalDate] = useState(doc.arrival_date ?? '')
  const [ttn, setTtn] = useState(doc.ttn ?? '')
  const [zoneId, setZoneId] = useState(doc.zone_id ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost ? String(doc.logistics_cost) : '')

  const [metaDirty, setMetaDirty] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const [pendingQty, setPendingQty] = useState<Record<string, number>>({})
  const [savingQty, setSavingQty] = useState<Record<string, boolean>>({})

  const [showAddLine, setShowAddLine] = useState(false)

  useEffect(() => {
    getInventoryClients().then((res) => setClients(res.filter((c) => c.is_active && !c.is_deleted)))
    getInventorySuppliers().then((res) => setSuppliers(res.filter((s) => s.is_active && !s.is_deleted)))
    getInventoryUnloadingZones().then((res) => setUnloadingZones(res.filter((z) => z.is_active && !z.is_deleted)))
  }, [])

  function markDirty() { setMetaDirty(true) }

  async function handleSaveMeta() {
    setMetaError('')
    setMetaSaving(true)
    try {
      const selectedZone = unloadingZones.find((z) => z.id === zoneId)
      await updateReceipt(docId, {
        client_id: clientId || undefined,
        supplier_name: supplierName.trim() || null,
        arrival_date: arrivalDate || null,
        ttn: ttn.trim() || null,
        zone_id: zoneId || null,
        zone_name: selectedZone?.name ?? null,
        logistics_cost: logisticsCost ? parseFloat(logisticsCost) : null,
      })
      setMetaDirty(false)
      await onReload()
    } catch (e: unknown) {
      setMetaError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setMetaSaving(false)
    }
  }

  function setPendingQtyFor(lineId: string, qty: number) {
    setPendingQty((prev) => ({ ...prev, [lineId]: qty }))
  }

  async function handleSaveLineQty(lineId: string, qty: number) {
    setSavingQty((prev) => ({ ...prev, [lineId]: true }))
    try {
      await updateReceiptLine(docId, lineId, qty)
      setPendingQty((prev) => { const next = { ...prev }; delete next[lineId]; return next })
      await onReload()
    } finally {
      setSavingQty((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  async function handleDeleteLine(lineId: string, productName: string) {
    const ok = await confirm({
      title: 'Удалить строку?',
      body: `«${productName}» будет удалена из черновика. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    await deleteReceiptLine(docId, lineId)
    await onReload()
  }

  const totalQty = lines.reduce((s, l) => s + l.planned_qty, 0)
  const totalSku = new Set(lines.map((l) => l.product_sku)).size

  const readyChecks = [
    { ok: !!clientId, label: 'Клиент указан', error: 'Не выбран клиент' },
    { ok: !!arrivalDate, label: 'Дата прибытия указана', error: 'Не указана дата прибытия' },
    { ok: lines.length > 0, label: `Строк добавлено: ${lines.length}`, error: 'Не добавлено ни одной строки' },
    { ok: lines.length > 0 && lines.every((l) => l.planned_qty >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
  ]

  const blockReasons = [
    ...(metaDirty ? ['Есть несохранённые изменения реквизитов'] : []),
    ...readyChecks.filter((c) => !c.ok).map((c) => c.error),
  ]

  return (
    <div className="page">
      {/* Заголовок */}
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/receipts')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge dot>{RECEIPT_STATUS_LABELS['draft']}</Badge>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              {doc.doc_number} · создан {fmtDate(doc.created_at)}
              {doc.created_by && ` · ${doc.created_by}`}
            </span>
          </div>
          <div className="page-title">Создание поступления</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {metaDirty && (
              <button className="btn" onClick={handleSaveMeta} disabled={metaSaving || !clientId}>
                <Icon name="check" size={14} />Сохранить изменения
              </button>
            )}
            <button
              className="btn primary"
              onClick={() => { if (blockReasons.length > 0) { setShowBlockReasons(true) } else { onAdvance() } }}
              disabled={advancing}
            >
              <Icon name="check" size={14} />Запланировать поступление
            </button>
          </div>
          {showBlockReasons && blockReasons.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--c-danger)', textAlign: 'right', lineHeight: 1.5 }}>
              {blockReasons.map((r, i) => (
                <div key={i}>· {r}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ReceiptStepper status="draft" ops={detail.ops} style={{ marginTop: -10 }} />

      {metaError && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'color-mix(in oklab, var(--c-danger) 10%, transparent)',
          border: '1px solid color-mix(in oklab, var(--c-danger) 30%, transparent)',
          borderRadius: 'var(--r-md)', color: 'var(--c-danger)', fontSize: 13,
        }}>
          {metaError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
        {/* Левая колонка */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Реквизиты */}
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
                    onChange={(v) => { setClientId(String(v ?? '')); markDirty() }}
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
                    <span className="text-xs faint">не обязательно</span>
                  </label>
                  <Combobox
                    value={suppliers.find((s) => s.name === supplierName)?.id ?? ''}
                    placeholder="Поиск поставщика…"
                    options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                    onChange={(v) => {
                      const found = suppliers.find((s) => s.id === String(v ?? ''))
                      setSupplierName(found?.name ?? '')
                      markDirty()
                    }}
                    clearable
                    prefix="user"
                  />
                </div>
                <div>
                  <label className="field-label">
                    <span>Дата прибытия <span style={{ color: 'var(--c-danger)' }}>*</span></span>
                  </label>
                  <DatePicker value={arrivalDate} onChange={(v) => { setArrivalDate(v); markDirty() }} />
                </div>
                <div>
                  <label className="field-label">
                    <span>Номер ТТН</span>
                    <span className="text-xs faint">не обязательно</span>
                  </label>
                  <input
                    className="input"
                    placeholder="TTN-00001"
                    value={ttn}
                    onChange={(e) => { setTtn(e.target.value); markDirty() }}
                  />
                </div>
                <div>
                  <label className="field-label">
                    <span>Зона разгрузки</span>
                    <span className="text-xs faint">не обязательно</span>
                  </label>
                  <Combobox
                    value={zoneId}
                    placeholder="Выберите зону…"
                    options={unloadingZones.map((z) => ({ value: z.id, label: z.name }))}
                    prefix="map"
                    onChange={(v) => { setZoneId(String(v ?? '')); markDirty() }}
                    clearable
                  />
                </div>
                <div>
                  <label className="field-label">
                    <span>Стоимость логистики, ₽</span>
                    <span className="text-xs faint">не обязательно</span>
                  </label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={logisticsCost}
                    onChange={(e) => { setLogisticsCost(e.target.value); markDirty() }}
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Строки */}
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
                  {lines.map((l, i) => {
                    const displayQty = pendingQty[l.id] ?? l.planned_qty
                    const isDirty = pendingQty[l.id] !== undefined && pendingQty[l.id] !== l.planned_qty
                    const isSaving = savingQty[l.id] ?? false
                    return (
                      <tr key={l.id}>
                        <Td><span className="mono" style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>{i + 1}</span></Td>
                        <Td>
                          <div style={{ fontWeight: 450 }}>{l.product_name}</div>
                          <div className="t-sub mono">{l.product_sku}</div>
                        </Td>
                        <Td>{l.color_name ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</Td>
                        <Td className="mono">{l.size_name ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</Td>
                        <Td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${isDirty ? 'var(--c-accent)' : 'var(--c-border-strong)'}`, borderRadius: 'var(--r-md)', height: 26, width: 120, background: 'var(--c-bg-elev)' }}>
                              <button
                                className="btn ghost icon sm"
                                style={{ height: 24, width: 24, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
                                onClick={() => setPendingQtyFor(l.id, Math.max(1, displayQty - 1))}
                              >
                                <Icon name="minus" size={10} />
                              </button>
                              <input
                                inputMode="numeric"
                                value={displayQty}
                                onChange={(e) => {
                                  const v = Math.max(1, parseInt(e.target.value.replace(/\D/g, '')) || 1)
                                  setPendingQtyFor(l.id, v)
                                }}
                                style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0, color: isDirty ? 'var(--c-accent)' : undefined }}
                              />
                              <button
                                className="btn ghost icon sm"
                                style={{ height: 24, width: 24, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
                                onClick={() => setPendingQtyFor(l.id, displayQty + 1)}
                              >
                                <Icon name="plus" size={10} />
                              </button>
                            </div>
                            {isDirty && (
                              <button
                                className="btn ghost icon sm"
                                style={{ color: 'var(--c-accent)', flexShrink: 0 }}
                                disabled={isSaving}
                                onClick={() => void handleSaveLineQty(l.id, displayQty)}
                                title="Сохранить"
                              >
                                <Icon name="save" size={14} />
                              </button>
                            )}
                          </div>
                        </Td>
                        <Td>
                          <button className="btn ghost icon sm" onClick={() => void handleDeleteLine(l.id, l.product_name)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </Td>
                      </tr>
                    )
                  })}
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

        {/* Правая колонка */}
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
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Icon name="check" size={10} />
                    </div>
                  ) : (
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px dashed var(--c-text-faint)', flexShrink: 0 }} />
                  )}
                  <span style={{ color: c.ok ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{c.label}</span>
                </div>
              ))}
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

      <AddLineDrawer2
        key={showAddLine ? 'open' : 'closed'}
        docId={docId}
        clientId={clientId}
        open={showAddLine}
        onClose={() => setShowAddLine(false)}
        onAdded={async () => { setShowAddLine(false); await onReload() }}
      />
    </div>
  )
}

// ─── Planned view (В пути — редактирование плана) ────────────────────────────

function PlannedView({
  docId,
  detail,
  onReload,
  onUpdateLineQty,
  onArrive,
  onCancel,
  advancing,
}: {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onUpdateLineQty: (lineId: string, qty: number) => void
  onArrive: () => void
  onCancel: () => void
  advancing: boolean
}) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { doc, lines } = detail

  const [unloadingZones, setUnloadingZones] = useState<DictionaryItem[]>([])
  const [supplierName, setSupplierName] = useState(doc.supplier_name ?? '')
  const [arrivalDate, setArrivalDate] = useState(doc.arrival_date ?? '')
  const [ttn, setTtn] = useState(doc.ttn ?? '')
  const [zoneId, setZoneId] = useState(doc.zone_id ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost ? String(doc.logistics_cost) : '')

  const [metaDirty, setMetaDirty] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const [pendingQty, setPendingQty] = useState<Record<string, number>>({})
  const [savingQty, setSavingQty] = useState<Record<string, boolean>>({})
  const [showAddLine, setShowAddLine] = useState(false)

  useEffect(() => {
    getInventoryUnloadingZones().then((res) => setUnloadingZones(res.filter((z) => z.is_active && !z.is_deleted)))
  }, [])

  function markDirty() { setMetaDirty(true) }

  async function handleSaveMeta() {
    setMetaError('')
    setMetaSaving(true)
    try {
      const selectedZone = unloadingZones.find((z) => z.id === zoneId)
      await updateReceipt(docId, {
        supplier_name: supplierName.trim() || null,
        arrival_date: arrivalDate || null,
        ttn: ttn.trim() || null,
        zone_id: zoneId || null,
        zone_name: selectedZone?.name ?? null,
        logistics_cost: logisticsCost ? parseFloat(logisticsCost) : null,
      })
      setMetaDirty(false)
      await onReload()
    } catch (e: unknown) {
      setMetaError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setMetaSaving(false)
    }
  }

  function setPendingQtyFor(lineId: string, qty: number) {
    setPendingQty((prev) => ({ ...prev, [lineId]: qty }))
  }

  async function handleSaveLineQty(lineId: string, qty: number) {
    setSavingQty((prev) => ({ ...prev, [lineId]: true }))
    try {
      await updateReceiptLine(docId, lineId, qty)
      setPendingQty((prev) => { const next = { ...prev }; delete next[lineId]; return next })
      onUpdateLineQty(lineId, qty)
    } finally {
      setSavingQty((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  async function handleDeleteLine(lineId: string, productName: string) {
    const ok = await confirm({
      title: 'Удалить строку?',
      body: `«${productName}» будет удалена из документа. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    await deleteReceiptLine(docId, lineId)
    await onReload()
  }

  const totalQty = lines.reduce((s, l) => s + l.planned_qty, 0)
  const totalSku = new Set(lines.map((l) => l.product_sku)).size

  const today = new Date().toISOString().slice(0, 10)
  const readyChecks = [
    { ok: !!arrivalDate, label: 'Дата прибытия указана', error: 'Не указана дата прибытия' },
    { ok: !arrivalDate || arrivalDate <= today, label: 'Дата прибытия наступила', error: 'Дата прибытия ещё не наступила' },
    { ok: lines.length > 0, label: `Строк: ${lines.length}`, error: 'Нет строк в документе' },
    { ok: lines.length > 0 && lines.every((l) => l.planned_qty >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
    { ok: !!logisticsCost && parseFloat(logisticsCost) >= 0, label: 'Стоимость логистики указана', error: 'Не указана стоимость логистики' },
  ]

  const hasPendingQty = Object.keys(pendingQty).some((id) => pendingQty[id] !== lines.find((l) => l.id === id)?.planned_qty)

  const blockReasons = [
    ...(metaDirty ? ['Есть несохранённые изменения реквизитов'] : []),
    ...(hasPendingQty ? ['Есть несохранённые изменения количества в строках товаров'] : []),
    ...readyChecks.filter((c) => !c.ok).map((c) => c.error),
  ]

  return (
    <div className="page">
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/receipts')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge tone="info" dot>{RECEIPT_STATUS_LABELS['planned']}</Badge>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              {doc.doc_number} · {doc.client_name ?? '—'}
            </span>
          </div>
          <div className="page-title">{doc.doc_number}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost danger" onClick={onCancel} disabled={advancing}>
              <Icon name="x" size={14} />Аннулировать
            </button>
            {metaDirty && (
              <button className="btn" onClick={handleSaveMeta} disabled={metaSaving}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
            <button
              className="btn primary"
              onClick={() => { if (blockReasons.length > 0) { setShowBlockReasons(true) } else { onArrive() } }}
              disabled={advancing}
            >
              <Icon name="arrowRight" size={14} />Зафиксировать прибытие
            </button>
          </div>
          {showBlockReasons && blockReasons.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--c-danger)', textAlign: 'right', lineHeight: 1.5 }}>
              {blockReasons.map((r, i) => <div key={i}>· {r}</div>)}
            </div>
          )}
        </div>
      </div>

      <ReceiptStepper status="planned" ops={detail.ops} style={{ marginTop: -10 }} />

      {metaError && (
        <div style={{
          padding: '10px 14px', marginBottom: 16,
          background: 'color-mix(in oklab, var(--c-danger) 10%, transparent)',
          border: '1px solid color-mix(in oklab, var(--c-danger) 30%, transparent)',
          borderRadius: 'var(--r-md)', color: 'var(--c-danger)', fontSize: 13,
        }}>
          {metaError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20, alignItems: 'start' }}>
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
                  <label className="field-label"><span>Клиент</span></label>
                  <input className="input" value={doc.client_name ?? ''} disabled />
                </div>
                <div>
                  <label className="field-label"><span>Поставщик</span></label>
                  <input className="input" placeholder="Название поставщика" value={supplierName}
                    onChange={(e) => { setSupplierName(e.target.value); markDirty() }} />
                </div>
                <div>
                  <label className="field-label">
                    <span>Дата прибытия <span style={{ color: 'var(--c-danger)' }}>*</span></span>
                  </label>
                  <DatePicker value={arrivalDate} onChange={(v) => { setArrivalDate(v); markDirty() }} />
                </div>
                <div>
                  <label className="field-label"><span>Номер ТТН</span></label>
                  <input className="input" placeholder="TTN-00001" value={ttn}
                    onChange={(e) => { setTtn(e.target.value); markDirty() }} />
                </div>
                <div>
                  <label className="field-label"><span>Зона разгрузки</span></label>
                  <Combobox
                    value={zoneId}
                    placeholder="Выберите зону…"
                    options={unloadingZones.map((z) => ({ value: z.id, label: z.name }))}
                    prefix="map"
                    onChange={(v) => { setZoneId(String(v ?? '')); markDirty() }}
                    clearable
                  />
                </div>
                <div>
                  <label className="field-label">
                    <span>Стоимость логистики, ₽ <span style={{ color: 'var(--c-danger)' }}>*</span></span>
                  </label>
                  <input className="input" type="number" min={0} placeholder="0" value={logisticsCost}
                    onChange={(e) => { setLogisticsCost(e.target.value); markDirty() }} />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Строки */}
          <Card>
            <CardHead>
              <Icon name="boxes" size={15} style={{ color: 'var(--c-accent)' }} />
              <span className="card-head-title">Товары</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{lines.length}</Badge>
              <div style={{ flex: 1 }} />
              <button className="btn sm primary" onClick={() => setShowAddLine(true)}>
                <Icon name="plus" size={12} />Добавить строку
              </button>
            </CardHead>
            {lines.length === 0 ? (
              <div className="empty">
                <div className="empty-illust" />
                <div style={{ fontSize: 14, fontWeight: 500 }}>Нет строк</div>
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
                  {lines.map((l, i) => {
                    const displayQty = pendingQty[l.id] ?? l.planned_qty
                    const isDirty = pendingQty[l.id] !== undefined && pendingQty[l.id] !== l.planned_qty
                    const isSaving = savingQty[l.id] ?? false
                    return (
                      <tr key={l.id}>
                        <Td><span className="mono" style={{ color: 'var(--c-text-faint)', fontSize: 11 }}>{i + 1}</span></Td>
                        <Td>
                          <div style={{ fontWeight: 450 }}>{l.product_name}</div>
                          <div className="t-sub mono">{l.product_sku}</div>
                        </Td>
                        <Td>{l.color_name ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</Td>
                        <Td className="mono">{l.size_name ?? <span style={{ color: 'var(--c-text-faint)' }}>—</span>}</Td>
                        <Td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${isDirty ? 'var(--c-accent)' : 'var(--c-border-strong)'}`, borderRadius: 'var(--r-md)', height: 26, width: 120, background: 'var(--c-bg-elev)' }}>
                              <button className="btn ghost icon sm" style={{ height: 24, width: 24, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
                                onClick={() => setPendingQtyFor(l.id, Math.max(1, displayQty - 1))}>
                                <Icon name="minus" size={10} />
                              </button>
                              <input inputMode="numeric" value={displayQty}
                                onChange={(e) => { const v = Math.max(1, parseInt(e.target.value.replace(/\D/g, '')) || 1); setPendingQtyFor(l.id, v) }}
                                style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0, color: isDirty ? 'var(--c-accent)' : undefined }} />
                              <button className="btn ghost icon sm" style={{ height: 24, width: 24, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
                                onClick={() => setPendingQtyFor(l.id, displayQty + 1)}>
                                <Icon name="plus" size={10} />
                              </button>
                            </div>
                            {isDirty && (
                              <button className="btn ghost icon sm" style={{ color: 'var(--c-accent)', flexShrink: 0 }} disabled={isSaving}
                                onClick={() => void handleSaveLineQty(l.id, displayQty)} title="Сохранить">
                                <Icon name="save" size={14} />
                              </button>
                            )}
                          </div>
                        </Td>
                        <Td>
                          <button className="btn ghost icon sm" onClick={() => void handleDeleteLine(l.id, l.product_name)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--c-bg-sunken)' }}>
                    <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>Итого: {totalSku} SKU</td>
                    <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>{totalQty}</td>
                    <td />
                  </tr>
                </tfoot>
              </Table>
            )}
          </Card>
        </div>

        {/* Правая колонка */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHead>
              <Icon name="check" size={15} style={{ color: 'var(--c-success)' }} />
              <span className="card-head-title">Готовность</span>
            </CardHead>
            <div style={{ padding: '4px 0' }}>
              {readyChecks.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13 }}>
                  {c.ok ? (
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--c-success-bg)', color: 'var(--c-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="check" size={10} />
                    </div>
                  ) : (
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px dashed var(--c-text-faint)', flexShrink: 0 }} />
                  )}
                  <span style={{ color: c.ok ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{c.label}</span>
                </div>
              ))}
            </div>
          </Card>
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

          {/* Журнал операций */}
          <div
            className="card"
            style={{
              position: 'sticky', top: 16, alignSelf: 'flex-start', width: '100%',
              maxHeight: 'calc(100vh - 200px)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div className="card-head" style={{ borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
              <Icon name="layers" size={15} style={{ color: 'var(--c-accent)' }} />
              <span className="card-head-title">Журнал операций</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{detail.ops.length}</Badge>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 3 }}>
                </span>
            </div>
            <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '4px 0' }}>
              {detail.ops.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
                  Нет операций
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 22, top: 12, bottom: 12, width: 1, background: 'var(--c-border)' }} />
                  {detail.ops.map((op) => (
                    <OpEntry key={op.id} op={op} onFilterLine={() => {}} />
                  ))}
                </div>
              )}
            </div>
            <div style={{
              padding: '8px 12px',
              borderTop: '1px solid var(--c-border)',
              background: 'var(--c-bg-sunken)',
              fontSize: 11,
              color: 'var(--c-text-subtle)',
              display: 'flex', alignItems: 'center', gap: 6,
              flexShrink: 0,
            }}>
              <Icon name="shield" size={11} />
              <span>Операции не редактируются. Удаление запрещено.</span>
            </div>
          </div>
        </div>
      </div>

      <AddLineDrawer2
        key={showAddLine ? 'open' : 'closed'}
        docId={docId}
        clientId={doc.client_id}
        open={showAddLine}
        onClose={() => setShowAddLine(false)}
        onAdded={async () => { setShowAddLine(false); await onReload() }}
      />
    </div>
  )
}

// ─── ReviewView (on_review + done) ───────────────────────────────────────────

type LineQcDraft = {
  accepted: number
  defect: number
}


function ReviewView({
  docId,
  detail,
  onReload,
  onAdvance,
  onReopen,
  advancing,
}: {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onAdvance: () => void
  onReopen: () => void
  advancing: boolean
}) {
  const navigate = useNavigate()
  const { doc, lines, ops } = detail

  const [drafts, setDrafts] = useState<Record<string, LineQcDraft>>({})
  const [completing, setCompleting] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [reopening, setReopening] = useState<Record<string, boolean>>({})
  const [lineError, setLineError] = useState<Record<string, string>>({})
  const [filterLine, setFilterLine] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [showBlockHint, setShowBlockHint] = useState(false)

  function getDraft(line: ReceiptLine): LineQcDraft {
    return drafts[line.id] ?? { accepted: line.accepted, defect: line.defect }
  }

  function setDraftField(lineId: string, field: 'accepted' | 'defect', value: number, serverAccepted: number, serverDefect: number) {
    setDrafts((prev) => {
      const cur = prev[lineId] ?? { accepted: serverAccepted, defect: serverDefect }
      return { ...prev, [lineId]: { ...cur, [field]: Math.max(0, value) } }
    })
  }

  async function handleCompleteClick(line: ReceiptLine) {
    const lineId = line.id
    const draft = getDraft(line)

    setLineError((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    setCompleting((prev) => ({ ...prev, [lineId]: true }))
    try {
      await completeReceiptLine(docId, lineId, { accepted: draft.accepted, defect: draft.defect })
      await onReload()
      setDrafts((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    } catch (e) {
      setLineError((prev) => ({ ...prev, [lineId]: e instanceof Error ? e.message : 'Ошибка' }))
    } finally {
      setCompleting((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  async function handleSaveDraft(line: ReceiptLine) {
    const lineId = line.id
    const draft = getDraft(line)
    const deltaAccepted = draft.accepted - line.accepted
    const deltaDefect = draft.defect - line.defect
    if (deltaAccepted === 0 && deltaDefect === 0) return
    setSaving((prev) => ({ ...prev, [lineId]: true }))
    try {
      if (deltaAccepted > 0) {
        await recordReceiptOp(docId, { line_id: lineId, op_type: 'receiving', qty: deltaAccepted })
      } else if (deltaAccepted < 0) {
        await recordReceiptOp(docId, { line_id: lineId, op_type: 'receiving_correction', qty: deltaAccepted })
      }
      if (deltaDefect > 0) {
        await recordReceiptOp(docId, { line_id: lineId, op_type: 'defect_fix', qty: deltaDefect })
      } else if (deltaDefect < 0) {
        await recordReceiptOp(docId, { line_id: lineId, op_type: 'defect_correction', qty: deltaDefect })
      }
      await onReload()
      setDrafts((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    } finally {
      setSaving((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  async function handleReopen(lineId: string) {
    setReopening((prev) => ({ ...prev, [lineId]: true }))
    try {
      await reopenReceiptLine(docId, lineId)
      await onReload()
      // сбрасываем draft чтобы поля инициализировались от свежего server state
      setDrafts((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    } finally {
      setReopening((prev) => { const next = { ...prev }; delete next[lineId]; return next })
    }
  }

  const allDone = lines.length > 0 && lines.every((l) => l.qc_status === 'done')
  const doneLinesCount = lines.filter((l) => l.qc_status === 'done').length

  const totals = lines.reduce(
    (acc, l) => {
      const d = getDraft(l)
      const accepted = l.qc_status === 'done' ? l.accepted : d.accepted
      const defect = l.qc_status === 'done' ? l.defect : d.defect
      const processed = accepted + defect
      acc.planned += l.planned_qty
      acc.accepted += accepted
      acc.defect += defect
      acc.processed += processed
      // Отклонения только по проверенным строкам (qc_status === 'done'), чтобы пересорт не компенсировался
      if (l.qc_status === 'done') {
        acc.surplus += Math.max(0, processed - l.planned_qty)
        acc.shortage += Math.max(0, l.planned_qty - processed)
      }
      return acc
    },
    { planned: 0, accepted: 0, defect: 0, processed: 0, surplus: 0, shortage: 0 },
  )
  const totalSurplus = totals.surplus
  const totalShortage = totals.shortage

  const visibleOps = ops.filter((op) => {
    if (filterLine && op.line_id !== filterLine) return false
    if (filterType && op.op_type !== filterType) return false
    return true
  })

  const isReadonly = doc.status === 'done'

  return (
    <div className="page">
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/receipts')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge tone={receiptStatusTone(doc.status) as BadgeTone} dot>
              {RECEIPT_STATUS_LABELS[doc.status]}
            </Badge>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              {doc.doc_number} · {doc.client_name ?? '—'}
            </span>
          </div>
          <div className="page-title" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="mono" style={{ fontWeight: 500 }}>{doc.doc_number}</span>
            {doc.zone_name && (
              <span style={{ fontSize: 14, color: 'var(--c-text-muted)', fontWeight: 450 }}>· {doc.zone_name}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isReadonly && (
            <button className="btn ghost" onClick={onReopen} disabled={advancing}>
              <Icon name="arrowLeft" size={14} />Вернуть на проверку
            </button>
          )}
          {!isReadonly && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <button
                className="btn primary"
                onClick={() => { if (!allDone) { setShowBlockHint(true) } else { onAdvance() } }}
                disabled={advancing}
              >
                <Icon name="check" size={14} />Завершить проверку
              </button>
              {showBlockHint && !allDone && (
                <div style={{ fontSize: 12, color: 'var(--c-danger)', textAlign: 'right', lineHeight: 1.5 }}>
                  · Осталось проверить строк: {lines.length - doneLinesCount}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ReceiptStepper status={doc.status} ops={ops} />

      {/* KPI */}
      {(() => {
        // Виджет 1: % обработки — НЕ ограничиваем 100%
        const processedPct = totals.planned > 0 ? Math.round(totals.processed / totals.planned * 100) : 0
        // Виджет 2: % принятых — ограничиваем 100%, излишек показываем отдельно
        const acceptedPct = totals.planned > 0 ? Math.min(100, Math.round(totals.accepted / totals.planned * 100)) : 0
        return (
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
            {/* 1. Проверено = объём обработки (принято + брак) */}
            <div className="kpi">
              <div className="kpi-label">Проверено</div>
              <div className="kpi-value">
                {totals.processed}
                <span style={{ fontSize: 14, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 6 }}>/ {totals.planned}</span>
              </div>
              <div style={{ fontSize: 12, color: processedPct > 100 ? 'var(--c-info, #3b82f6)' : 'var(--c-text-subtle)', marginTop: 2, fontWeight: processedPct > 100 ? 600 : 400 }}>{processedPct}%</div>
              <div className="prog" style={{ marginTop: 6 }}>
                <div className="prog-fill" style={{ width: `${Math.min(100, processedPct)}%` }} />
              </div>
            </div>
            {/* 2. Принято = результат склада */}
            <div className="kpi">
              <div className="kpi-label">Принято</div>
              <div className="kpi-value">
                {totals.accepted}
                <span style={{ fontSize: 14, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 6 }}>/ {totals.planned}</span>
              </div>
              <div style={{ fontSize: 12, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--c-info, #3b82f6)', fontWeight: 600 }}>{acceptedPct}%</span>
                {totalSurplus > 0 && (
                  <span style={{ color: 'var(--c-warning)', fontWeight: 600 }}>+{totalSurplus} сверх плана</span>
                )}
              </div>
              <div className="prog" style={{ marginTop: 6 }}>
                <div className="prog-fill" style={{ width: `${acceptedPct}%` }} />
              </div>
            </div>
            {/* 3. Отклонения = брак, недостача, излишек */}
            <div className="kpi">
              <div className="kpi-label">Отклонения</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {totals.defect > 0 && (
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Брак: </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-warning)' }}>{totals.defect}</span>
                  </div>
                )}
                {totalShortage > 0 && (
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Недостача: </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-warning)' }}>−{totalShortage}</span>
                  </div>
                )}
                {totalSurplus > 0 && (
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Излишек: </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-info, #3b82f6)' }}>+{totalSurplus}</span>
                  </div>
                )}
                {totals.defect === 0 && totalShortage === 0 && totalSurplus === 0 && (
                  <div style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Нет отклонений</div>
                )}
              </div>
            </div>
            {/* 4. Состав поступления */}
            <div className="kpi">
              <div className="kpi-label">Состав поступления</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 6, columnGap: 10, fontSize: 13, marginTop: 8 }}>
                <span style={{ color: 'var(--c-text-muted)' }}>SKU</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }} className="mono">{detail.state.sku_count}</span>
                <span style={{ color: 'var(--c-text-muted)' }}>Строк</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }} className="mono">{lines.length}</span>
              </div>
            </div>
          </div>
        )
      })()}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Таблица строк */}
          <Card>
            <CardHead>
              <Icon name="boxes" size={15} style={{ color: 'var(--c-accent)' }} />
              <span className="card-head-title">Товары</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{lines.length}</Badge>
              {!isReadonly && allDone && (
                <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--c-success)', fontWeight: 500 }}>
                  <Icon name="check" size={12} /> Все строки проверены
                </span>
              )}
            </CardHead>
            <Table>
              <thead>
                <tr>
                  <th style={{ width: 20 }} />
                  <th>Товар</th>
                  <th style={{ width: 55, textAlign: 'right' }}>План</th>
                  <th style={{ width: 124, textAlign: 'right' }}>Принято</th>
                  <th style={{ width: 124, textAlign: 'right' }}>Брак</th>
                  <th style={{ width: 130 }}>Статус</th>
                  <th style={{ width: 120 }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const draft = getDraft(line)
                  const isDone = line.qc_status === 'done'
                  const isInProgress = line.qc_status === 'in_progress'
                  const isCompleting = completing[line.id] ?? false
                  const isSaving = saving[line.id] ?? false
                  const isReopening = reopening[line.id] ?? false
                  const hasDraftChange = draft.accepted !== line.accepted || draft.defect !== line.defect
                  const lineErr = lineError[line.id]

                  const processed = isDone ? (line.accepted + line.defect) : (draft.accepted + draft.defect)
                  const defectPct = processed > 0 ? Math.round((isDone ? line.defect : draft.defect) / processed * 100) : 0

                  let surplus = 0
                  let shortage = 0
                  if (isDone) {
                    surplus = Math.max(0, processed - line.planned_qty)
                    shortage = Math.max(0, line.planned_qty - processed)
                  }

                  const statusColor = isDone
                    ? 'var(--c-success)'
                    : isInProgress
                    ? 'var(--c-info, #3b82f6)'
                    : 'var(--c-text-faint)'

                  const statusBg = isDone
                    ? 'var(--c-success-bg)'
                    : isInProgress
                    ? 'color-mix(in oklab, var(--c-info, #3b82f6) 12%, transparent)'
                    : 'transparent'

                  const statusLabel = isDone ? 'Проверено' : isInProgress ? 'В работе' : 'Не начато'

                  return (
                    <tr key={line.id}>
                      <Td>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: isDone ? 'var(--c-success)' : isInProgress ? 'var(--c-info, #3b82f6)' : 'var(--c-border-strong)' }} />
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{line.product_name}</div>
                        <div className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                          {line.product_sku}
                          {line.color_name ? ` · ${line.color_name}` : ''}
                          {line.size_name ? ` · ${line.size_name}` : ''}
                        </div>
                      </Td>
                      <Td className="num" style={{ color: 'var(--c-text-muted)' }}>{line.planned_qty}</Td>
                      <Td style={{ textAlign: 'right' }}>
                        {isDone || isReadonly ? (
                          <span style={{ fontWeight: 500 }}>{line.accepted}</span>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 26, width: 110, background: 'var(--c-bg-elev)' }}>
                            <button
                              className="btn ghost icon sm"
                              style={{ height: 24, width: 24, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
                              disabled={isCompleting}
                              onClick={() => setDraftField(line.id, 'accepted', draft.accepted - 1, line.accepted, line.defect)}
                            >
                              <Icon name="minus" size={10} />
                            </button>
                            <input
                              inputMode="numeric"
                              value={draft.accepted}
                              disabled={isCompleting}
                              onChange={(e) => {
                                const v = parseInt(e.target.value.replace(/\D/g, '')) || 0
                                setDraftField(line.id, 'accepted', v, line.accepted, line.defect)
                              }}
                              style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0 }}
                            />
                            <button
                              className="btn ghost icon sm"
                              style={{ height: 24, width: 24, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
                              disabled={isCompleting}
                              onClick={() => setDraftField(line.id, 'accepted', draft.accepted + 1, line.accepted, line.defect)}
                            >
                              <Icon name="plus" size={10} />
                            </button>
                          </div>
                        )}
                      </Td>
                      <Td style={{ textAlign: 'right' }}>
                        {isDone || isReadonly ? (
                          <span style={{ fontWeight: 500, color: line.defect > 0 ? 'var(--c-warning)' : undefined }}>
                            {line.defect}
                            <span style={{ fontSize: 11, color: 'var(--c-text-subtle)', fontWeight: 400, marginLeft: 4 }}>({defectPct}%)</span>
                          </span>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 26, width: 110, background: 'var(--c-bg-elev)' }}>
                            <button
                              className="btn ghost icon sm"
                              style={{ height: 24, width: 24, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
                              disabled={isCompleting}
                              onClick={() => setDraftField(line.id, 'defect', draft.defect - 1, line.accepted, line.defect)}
                            >
                              <Icon name="minus" size={10} />
                            </button>
                            <input
                              inputMode="numeric"
                              value={draft.defect}
                              disabled={isCompleting}
                              onChange={(e) => {
                                const v = parseInt(e.target.value.replace(/\D/g, '')) || 0
                                setDraftField(line.id, 'defect', v, line.accepted, line.defect)
                              }}
                              style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: "'zero' 0", background: 'transparent', minWidth: 0, color: draft.defect > 0 ? 'var(--c-warning)' : undefined }}
                            />
                            <button
                              className="btn ghost icon sm"
                              style={{ height: 24, width: 24, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
                              disabled={isCompleting}
                              onClick={() => setDraftField(line.id, 'defect', draft.defect + 1, line.accepted, line.defect)}
                            >
                              <Icon name="plus" size={10} />
                            </button>
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div>
                          <span style={{
                            fontSize: 11.5, fontWeight: 500, padding: '2px 7px', borderRadius: 'var(--r-sm)',
                            color: statusColor, background: statusBg,
                          }}>
                            {statusLabel}
                          </span>
                          {isDone && surplus > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--c-info, #3b82f6)', marginTop: 3 }}>▲ +{surplus} излишек</div>
                          )}
                          {isDone && shortage > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--c-warning)', marginTop: 3 }}>▼ −{shortage} недостача</div>
                          )}
                        </div>
                      </Td>
                      <Td>
                        {!isReadonly && (
                          isDone ? (
                            <button
                              className="btn ghost sm"
                              onClick={() => void handleReopen(line.id)}
                              disabled={isReopening}
                            >
                              <Icon name="edit" size={12} />Редактировать
                            </button>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {hasDraftChange && (
                                  <button
                                    className="btn ghost icon sm"
                                    title="Сохранить без завершения"
                                    onClick={() => void handleSaveDraft(line)}
                                    disabled={isSaving || isCompleting}
                                  >
                                    <Icon name="save" size={14} />
                                  </button>
                                )}
                                <button
                                  className="btn sm primary"
                                  onClick={() => void handleCompleteClick(line)}
                                  disabled={isCompleting || isSaving}
                                >
                                  <Icon name="check" size={12} />Завершить
                                </button>
                              </div>
                              {lineErr && (
                                <div style={{ fontSize: 11, color: 'var(--c-danger)', maxWidth: 160 }}>{lineErr}</div>
                              )}
                            </div>
                          )
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--c-bg-sunken)' }}>
                  <td />
                  <td style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>Итого</td>
                  <td className="num" style={{ padding: '10px 12px', color: 'var(--c-text-muted)' }}>{totals.planned}</td>
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600 }}>{totals.accepted}</td>
                  <td className="num" style={{ padding: '10px 12px', fontWeight: 600, color: totals.defect > 0 ? 'var(--c-warning)' : undefined }}>
                    {totals.defect}
                    {totals.defect > 0 && totals.processed > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--c-text-subtle)', marginLeft: 4 }}>
                        ({Math.round(totals.defect / totals.processed * 100)}%)
                      </span>
                    )}
                  </td>
                  <td colSpan={2} style={{ padding: '10px 12px', fontSize: 12 }}>
                    {totalSurplus > 0 && <span style={{ color: 'var(--c-info, #3b82f6)', marginRight: 10 }}>▲ +{totalSurplus} излишек</span>}
                    {totalShortage > 0 && <span style={{ color: 'var(--c-warning)' }}>▼ −{totalShortage} недостача</span>}
                  </td>
                </tr>
              </tfoot>
            </Table>
          </Card>

          {/* Основная информация */}
          <Card>
            <CardHead>
              <Icon name="file" size={15} />
              <span className="card-head-title">Основная информация</span>
            </CardHead>
            <CardBody style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 24px', fontSize: 12.5 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Клиент</div>
                <div>{doc.client_name ?? '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Поставщик</div>
                <div>{doc.supplier_name || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>ТТН</div>
                <div className="mono">{doc.ttn || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Дата прибытия</div>
                <div>{fmtDate(doc.arrival_date)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Зона разгрузки</div>
                <div>{doc.zone_name || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 2 }}>Стоимость логистики</div>
                <div className="mono">{doc.logistics_cost.toLocaleString('ru-RU')} ₽</div>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Правая колонка: Готовность + Журнал */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <CardHead>
              <Icon name="check" size={15} style={{ color: 'var(--c-success)' }} />
              <span className="card-head-title">Готовность</span>
            </CardHead>
            <div style={{ padding: '4px 0' }}>
              {[
                {
                  ok: lines.length > 0,
                  label: `Строк: ${doneLinesCount} / ${lines.length}`,
                  error: 'Нет строк в документе',
                },
                {
                  ok: lines.length > 0 && doneLinesCount === lines.length,
                  label: 'Все строки проверены',
                  error: `Осталось проверить: ${lines.length - doneLinesCount}`,
                },
              ].map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13 }}>
                  {c.ok ? (
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--c-success-bg)', color: 'var(--c-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="check" size={10} />
                    </div>
                  ) : (
                    <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px dashed var(--c-text-faint)', flexShrink: 0 }} />
                  )}
                  <span style={{ color: c.ok ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{c.ok ? c.label : c.error}</span>
                </div>
              ))}
            </div>
          </Card>

        {/* Журнал операций */}
        <div
          className="card"
          style={{ position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }}
        >
          <CardHead style={{ borderBottom: '1px solid var(--c-border)', flexShrink: 0 } as React.CSSProperties}>
            <Icon name="layers" size={15} style={{ color: 'var(--c-accent)' }} />
            <span className="card-head-title">Журнал операций</span>
            <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{ops.length}</Badge>
          </CardHead>
          <div style={{ padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: 6, borderBottom: '1px solid var(--c-border)', flexShrink: 0 }}>
            <FilterChip
              label="Тип"
              value={filterType ? (RECEIPT_OP_LABELS[filterType as keyof typeof RECEIPT_OP_LABELS] ?? filterType) : undefined}
              active={!!filterType}
              onClick={() => setFilterType(null)}
              onClear={() => setFilterType(null)}
            />
            <FilterChip
              label="Строка"
              value={filterLine ?? undefined}
              active={!!filterLine}
              onClick={() => setFilterLine(null)}
              onClear={() => setFilterLine(null)}
            />
          </div>
          <div style={{ flex: '1 1 auto', overflow: 'auto', padding: '4px 0' }}>
            {visibleOps.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
                {filterLine || filterType ? 'Под фильтр ничего не попало' : 'Нет операций'}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: 22, top: 12, bottom: 12, width: 1, background: 'var(--c-border)' }} />
                {visibleOps.map((op) => (
                  <OpEntry key={op.id} op={op} onFilterLine={(lid) => setFilterLine(lid)} />
                ))}
              </div>
            )}
          </div>
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)', fontSize: 11, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Icon name="shield" size={11} />
            <span>Операции не редактируются. Удаление запрещено.</span>
          </div>
        </div>
        </div>{/* конец правой колонки */}
      </div>

    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReceiptDetailFeature({ docId }: Props) {
  const confirm = useConfirm()
  const [detail, setDetail] = useState<ReceiptDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [advancing, setAdvancing] = useState(false)

  function handleUpdateLineQty(lineId: string, qty: number) {
    setDetail((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        lines: prev.lines.map((l) => l.id === lineId ? { ...l, planned_qty: qty } : l),
        state: {
          ...prev.state,
          lines: prev.state.lines.map((l) => l.id === lineId ? { ...l, planned_qty: qty } : l),
          total_planned: prev.state.lines.reduce((s, l) => s + (l.id === lineId ? qty : l.planned_qty), 0),
        },
      }
    })
  }

  const load = useCallback(async () => {
    try {
      const d = await getReceipt(docId)
      setDetail(d)
    } catch {
      setError('Документ не найден')
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => { void load() }, [load])

  async function handleAdvance() {
    setAdvancing(true)
    try {
      await advanceReceiptStatus(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setAdvancing(false)
    }
  }

  async function handleArrive() {
    setAdvancing(true)
    try {
      await arriveReceipt(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setAdvancing(false)
    }
  }

  async function handleCancel() {
    const d = detail!
    const ok = await confirm({
      title: 'Аннулировать документ?',
      body: `Документ ${d.doc.doc_number} будет аннулирован. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Аннулировать',
    })
    if (!ok) return
    try {
      await cancelReceipt(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  async function handleReopen() {
    const ok = await confirm({
      title: 'Вернуть на проверку?',
      body: 'Документ будет переведён обратно в статус «На проверке». Все строки останутся без изменений.',
      confirmLabel: 'Вернуть на проверку',
    })
    if (!ok) return
    setAdvancing(true)
    try {
      await reopenReceipt(docId)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setAdvancing(false)
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--c-danger)' }}>
          {error || 'Документ не найден'}
        </div>
      </div>
    )
  }

  // Draft — render the create-like form
  if (detail.doc.status === 'draft') {
    return (
      <DraftView
        docId={docId}
        detail={detail}
        onReload={load}
        onAdvance={handleAdvance}
        advancing={advancing}
      />
    )
  }

  // Planned — редактирование плана, фиксация прибытия или аннулирование
  if (detail.doc.status === 'planned') {
    return (
      <PlannedView
        docId={docId}
        detail={detail}
        onReload={load}
        onUpdateLineQty={handleUpdateLineQty}
        onArrive={handleArrive}
        onCancel={handleCancel}
        advancing={advancing}
      />
    )
  }

  // on_review и done — рендерятся через ReviewView
  return (
    <ReviewView
      docId={docId}
      detail={detail}
      onReload={load}
      onAdvance={handleAdvance}
      onReopen={handleReopen}
      advancing={advancing}
    />
  )
}

// ─── OpEntry ─────────────────────────────────────────────────────────────────

function OpEntry({ op, onFilterLine }: { op: ReceiptOp; onFilterLine: (lid: string) => void }) {
  const tone = OP_TONES[op.op_type] ?? ''
  const iconName = OP_ICONS[op.op_type] ?? 'layers'
  const label = RECEIPT_OP_LABELS[op.op_type as keyof typeof RECEIPT_OP_LABELS] ?? op.op_type

  const bgMap: Record<string, string> = {
    accent: 'var(--c-accent-bg)',
    success: 'var(--c-success-bg)',
    warning: 'color-mix(in oklab, var(--c-warning) 18%, var(--c-bg))',
    info: 'color-mix(in oklab, var(--c-info, #3b82f6) 15%, var(--c-bg))',
    danger: 'color-mix(in oklab, var(--c-danger) 12%, var(--c-bg))',
    '': 'var(--c-bg-sunken)',
  }
  const borderMap: Record<string, string> = {
    accent: 'var(--c-accent-border)',
    success: 'color-mix(in oklab, var(--c-success) 35%, transparent)',
    warning: 'color-mix(in oklab, var(--c-warning) 40%, transparent)',
    info: 'color-mix(in oklab, var(--c-info, #3b82f6) 35%, transparent)',
    danger: 'color-mix(in oklab, var(--c-danger) 35%, transparent)',
    '': 'var(--c-border)',
  }
  const colorMap: Record<string, string> = {
    accent: 'var(--c-accent)',
    success: 'var(--c-success)',
    warning: 'var(--c-warning)',
    info: 'var(--c-info, #3b82f6)',
    danger: 'var(--c-danger)',
    '': 'var(--c-text-muted)',
  }

  const email = op.created_by_email || op.created_by || ''
  const initials = email ? getInitials(email.split('@')[0]) : '?'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', padding: '8px 12px 8px 0', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: 2 }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          background: bgMap[tone] ?? bgMap[''],
          border: `1px solid ${borderMap[tone] ?? borderMap['']}`,
          color: colorMap[tone] ?? colorMap[''],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', zIndex: 1, flexShrink: 0,
        }}>
          <Icon name={iconName as never} size={11} />
        </div>
      </div>
      <div style={{ minWidth: 0, paddingTop: 1 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 2, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
          {op.line_id && (
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--c-accent)', cursor: 'pointer', background: 'var(--c-accent-bg)', padding: '1px 5px', borderRadius: 4 }}
              onClick={() => onFilterLine(op.line_id!)}
              title="Фильтровать по этой строке"
            >
              строка
            </span>
          )}
          {op.qty != null && (
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{op.qty} шт</span>
          )}
        </div>
        {op.comment && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', marginBottom: 3, lineHeight: 1.45 }}>{op.comment}</div>
        )}
        {op.reason && (
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', marginBottom: 3 }}>Причина: {op.reason}</div>
        )}
        <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--c-text-subtle)', alignItems: 'center' }}>
          {email && <Avatar initials={initials} />}
          {email && <span>{email}</span>}
          {email && <span>·</span>}
          <span className="mono">{fmtDateTime(op.created_at)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── AddLineDrawer2 ───────────────────────────────────────────────────────────

function AddLineDrawer2({
  docId,
  clientId,
  open,
  onClose,
  onAdded,
}: {
  docId: string
  clientId: string
  open: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [productId, setProductId] = useState('')
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [colorId, setColorId] = useState('')
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [sizeId, setSizeId] = useState('')
  const [qty, setQty] = useState(0)
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

  async function handleAdd() {
    if (!selectedProduct) { setError('Выберите товар'); return }
    if (needsSize && !sizeId) { setError('Выберите размер — он обязателен для этого типа товара'); return }
    if (qty < 0) { setError('Количество не может быть отрицательным'); return }
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

  const needsColor = selectedProduct?.requires_color ?? false
  const needsSize = selectedProduct?.requires_size ?? false
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
          <button className="btn primary" disabled={!productId || qty < 0 || saving} onClick={handleAdd}>
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
          <span>Плановое количество</span>
        </label>
        <div style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', height: 30, width: 160, background: 'var(--c-bg-elev)' }}>
          <button
            className="btn ghost icon sm"
            style={{ height: 28, width: 26, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
            onClick={() => setQty((q) => Math.max(0, q - 1))}
          >
            <Icon name="minus" size={11} />
          </button>
          <input
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))}
            style={{ flex: 1, border: 0, outline: 'none', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', background: 'transparent', minWidth: 0 }}
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
