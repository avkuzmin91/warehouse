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
import { useLookups } from '../../../../../hooks/useLookups'
import { ReceiptStepper } from '../../ReceiptStepper'
import { AddLineDrawer } from '../components/AddLineDrawer'
import { OpEntry } from '../components/OpEntry'

type Props = {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onUpdateLineQty: (lineId: string, qty: number) => void
  onArrive: () => void
  onCancel: () => void
  advancing: boolean
}

export function PlannedView({
  docId,
  detail,
  onReload,
  onUpdateLineQty,
  onArrive,
  onCancel,
  advancing,
}: Props) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { doc, lines } = detail

  const [supplierName, setSupplierName] = useState(doc.supplier_name ?? '')
  const [arrivalDate, setArrivalDate] = useState(doc.arrival_date ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost ? String(doc.logistics_cost) : '')

  const [metaDirty, setMetaDirty] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)

  const [pendingQty, setPendingQty] = useState<Record<string, number>>({})
  const [savingQty, setSavingQty] = useState<Record<string, boolean>>({})
  const [pendingStorage, setPendingStorage] = useState<Record<string, string>>({})
  const [savingStorage, setSavingStorage] = useState<Record<string, boolean>>({})
  const [showAddLine, setShowAddLine] = useState(false)

  const { suppliers: suppliersAll, unloadingZones: zonesAll } = useLookups()
  const suppliers: DictionaryItem[] = suppliersAll.filter((s) => s.is_active && !s.is_deleted)
  const storageZones: DictionaryItem[] = zonesAll.filter((z) => z.is_active && !z.is_deleted)

  function markDirty() { setMetaDirty(true) }

  async function handleSaveMeta(): Promise<boolean> {
    setMetaError('')
    setMetaSaving(true)
    try {
      await updateReceipt(docId, {
        supplier_name: supplierName.trim() || null,
        arrival_date: arrivalDate || null,
        logistics_cost: logisticsCost ? parseFloat(logisticsCost) : null,
      })
      setMetaDirty(false)
      await onReload()
      return true
    } catch (e: unknown) {
      setMetaError(e instanceof Error ? e.message : 'Ошибка')
      return false
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

  async function handleSaveLineStorage(lineId: string, zoneId: string) {
    const selectedZone = storageZones.find((z) => z.id === zoneId)
    setSavingStorage((prev) => ({ ...prev, [lineId]: true }))
    try {
      await updateReceiptLine(docId, lineId, {
        storage_zone_id: zoneId || null,
        storage_zone_name: selectedZone?.name ?? null,
      })
      setPendingStorage((prev) => { const next = { ...prev }; delete next[lineId]; return next })
      await onReload()
    } finally {
      setSavingStorage((prev) => { const next = { ...prev }; delete next[lineId]; return next })
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
  const missingStorageCount = lines.filter((l) => !l.storage_zone_id).length
  const hasPendingStorage = Object.keys(pendingStorage).some(
    (id) => pendingStorage[id] !== (lines.find((l) => l.id === id)?.storage_zone_id ?? ''),
  )

  const today = new Date().toISOString().slice(0, 10)
  const readyChecks = [
    { ok: !!arrivalDate, label: 'Дата прибытия указана', error: 'Не указана дата прибытия' },
    { ok: !arrivalDate || arrivalDate <= today, label: 'Дата прибытия наступила', error: 'Дата прибытия ещё не наступила' },
    { ok: lines.length > 0, label: `Строк: ${lines.length}`, error: 'Нет строк в документе' },
    { ok: lines.length > 0 && lines.every((l) => l.planned_qty >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
    { ok: lines.length > 0 && missingStorageCount === 0, label: 'Зона хранения указана по всем строкам', error: `Не указана зона хранения: ${missingStorageCount}` },
    { ok: !!logisticsCost && parseFloat(logisticsCost) >= 0, label: 'Стоимость логистики указана', error: 'Не указана стоимость логистики' },
  ]

  const hasPendingQty = Object.keys(pendingQty).some((id) => pendingQty[id] !== lines.find((l) => l.id === id)?.planned_qty)

  const blockReasons = [
    ...(hasPendingQty ? ['Есть несохранённые изменения количества в строках товаров'] : []),
    ...(hasPendingStorage ? ['Есть несохранённые изменения зоны хранения'] : []),
    ...readyChecks.filter((c) => !c.ok).map((c) => c.error),
  ]

  async function handleArrive() {
    if (metaDirty) {
      const ok = await handleSaveMeta()
      if (!ok) return
    }
    onArrive()
  }

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
              onClick={() => { if (blockReasons.length > 0) { setShowBlockReasons(true) } else { void handleArrive() } }}
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
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{metaError}</Alert>
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
                  <Combobox
                    value={suppliers.find((s) => s.name === supplierName)?.id ?? ''}
                    placeholder="Выберите поставщика"
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
                    <th style={{ width: 170 }}>Хранение</th>
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: 166 }}>
                            <div className="storage-cell-combobox">
                              <Combobox
                                value={pendingStorage[l.id] ?? l.storage_zone_id ?? ''}
                                placeholder="Выберите"
                                options={storageZones.map((z) => ({ value: z.id, label: z.name }))}
                                onChange={(value) => setPendingStorage((prev) => ({ ...prev, [l.id]: String(value ?? '') }))}
                                disabled={savingStorage[l.id] || storageZones.length === 0}
                                clearable
                              />
                            </div>
                            {pendingStorage[l.id] !== undefined && pendingStorage[l.id] !== (l.storage_zone_id ?? '') && (
                              <button
                                className="btn ghost icon sm"
                                style={{ color: 'var(--c-accent)', flexShrink: 0 }}
                                disabled={savingStorage[l.id]}
                                onClick={() => void handleSaveLineStorage(l.id, pendingStorage[l.id])}
                                title="Сохранить"
                              >
                                <Icon name="save" size={14} />
                              </button>
                            )}
                          </div>
                        </Td>
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
                    <td colSpan={5} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>Итого: {totalSku} SKU</td>
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

      <AddLineDrawer
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
