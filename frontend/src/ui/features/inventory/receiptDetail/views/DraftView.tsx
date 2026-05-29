import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RECEIPT_STATUS_LABELS,
  deleteReceiptLine,
  updateReceipt,
  updateReceiptLine,
} from '../../../../../api/receiptsApi'
import type { ReceiptDetail } from '../../../../../api/receiptsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { Combobox } from '../../../../data/Combobox'
import { Table, Td } from '../../../../data/Table'
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { Alert } from '../../../../primitives/Alert'
import { Badge } from '../../../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../../../primitives/Card'
import { DatePicker } from '../../../../primitives/DatePicker'
import { Icon } from '../../../../primitives/Icon'
import { fmtDate } from '../../../../../utils/format'
import { useLookups } from '../../../../../hooks/useLookups'
import { ReceiptStepper } from '../../ReceiptStepper'
import { AddLineDrawer } from '../components/AddLineDrawer'

type Props = {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onAdvance: () => void
  advancing: boolean
}

export function DraftView({ docId, detail, onReload, onAdvance, advancing }: Props) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { doc, lines } = detail

  const [clientId, setClientId] = useState(doc.client_id)
  const [supplierName, setSupplierName] = useState(doc.supplier_name ?? '')
  const [arrivalDate, setArrivalDate] = useState(doc.arrival_date ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost ? String(doc.logistics_cost) : '')

  const [metaDirty, setMetaDirty] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const [pendingQty, setPendingQty] = useState<Record<string, number>>({})
  const [savingQty, setSavingQty] = useState<Record<string, boolean>>({})

  const [showAddLine, setShowAddLine] = useState(false)

  const { clients: clientsAll, suppliers: suppliersAll } = useLookups()
  const clients: DictionaryItem[] = clientsAll.filter((c) => c.is_active && !c.is_deleted)
  const suppliers: DictionaryItem[] = suppliersAll.filter((s) => s.is_active && !s.is_deleted)

  function markDirty() { setMetaDirty(true) }

  async function handleSaveMeta() {
    setMetaError('')
    setMetaSaving(true)
    try {
      await updateReceipt(docId, {
        client_id: clientId || undefined,
        supplier_name: supplierName.trim() || null,
        arrival_date: arrivalDate || null,
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
          <div className="detail-status-row">
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/receipts')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge dot>{RECEIPT_STATUS_LABELS['draft']}</Badge>
            <span className="detail-meta">
              {doc.doc_number} · создан {fmtDate(doc.created_at)}
              {doc.created_by && ` · ${doc.created_by}`}
            </span>
          </div>
          <div className="page-title">Создание поступления</div>
        </div>
        <div className="detail-actions">
          <div className="detail-actions-row">
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
            <div className="block-reasons">
              {blockReasons.map((r, i) => (
                <div key={i}>· {r}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ReceiptStepper status="draft" ops={detail.ops} style={{ marginTop: -10 }} />

      {metaError && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{metaError}</Alert>
      )}

      <div className="split-300">
        {/* Левая колонка */}
        <div className="col gap-16">
          {/* Реквизиты */}
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
                  <tr className="sum">
                    <td colSpan={4}>Итого: {totalSku} SKU</td>
                    <td className="num">{totalQty}</td>
                    <td />
                  </tr>
                </tfoot>
              </Table>
            )}
          </Card>

        </div>

        {/* Правая колонка */}
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

      <AddLineDrawer
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
