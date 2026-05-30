import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RECEIPT_STATUS_LABELS,
  deleteReceiptLine,
  updateReceipt,
  updateReceiptLine,
} from '../../../../../api/receiptsApi'
import type { ReceiptArriveLine, ReceiptDetail, ReceiptLineUpdatePayload } from '../../../../../api/receiptsApi'
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
import { NumberStep } from '../../shared/NumberStep'
import { ReceiptStepper } from '../../ReceiptStepper'
import { AddLineDrawer } from '../components/AddLineDrawer'
import { OpEntry } from '../components/OpEntry'

type Props = {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onArrive: (lines: ReceiptArriveLine[]) => void
  onCancel: () => void
  advancing: boolean
}

export function PlannedView({
  docId,
  detail,
  onReload,
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
  const [pendingStorage, setPendingStorage] = useState<Record<string, string>>({})
  const [accepted, setAccepted] = useState<Record<string, number>>({})
  const [showAddLine, setShowAddLine] = useState(false)

  // «Принят» вводится при фиксации прибытия. Предзаполняем планом как наиболее частым значением.
  function acceptedFor(lineId: string): number {
    const line = lines.find((l) => l.id === lineId)
    return accepted[lineId] ?? line?.accepted_qty ?? line?.planned_qty ?? 0
  }

  function plannedQtyFor(lineId: string): number {
    const line = lines.find((l) => l.id === lineId)
    return pendingQty[lineId] ?? line?.planned_qty ?? 0
  }

  function storageZoneFor(lineId: string): string {
    const line = lines.find((l) => l.id === lineId)
    return pendingStorage[lineId] ?? line?.storage_zone_id ?? ''
  }

  const { suppliers: suppliersAll, unloadingZones: zonesAll } = useLookups()
  const suppliers: DictionaryItem[] = suppliersAll.filter((s) => s.is_active && !s.is_deleted)
  const storageZones: DictionaryItem[] = zonesAll.filter((z) => z.is_active && !z.is_deleted)

  function markDirty() { setMetaDirty(true) }

  async function handleSaveChanges(): Promise<boolean> {
    if (!hasUnsavedChanges) return true
    setMetaError('')
    setMetaSaving(true)
    try {
      if (metaDirty) {
        await updateReceipt(docId, {
          supplier_name: supplierName.trim() || null,
          arrival_date: arrivalDate || null,
          logistics_cost: logisticsCost ? parseFloat(logisticsCost) : null,
        })
      }
      for (const line of lines) {
        const qtyDirty = pendingQty[line.id] !== undefined && pendingQty[line.id] !== line.planned_qty
        const storageDirty = pendingStorage[line.id] !== undefined && pendingStorage[line.id] !== (line.storage_zone_id ?? '')
        if (!qtyDirty && !storageDirty) continue

        const payload: ReceiptLineUpdatePayload = {}
        if (qtyDirty) payload.planned_qty = pendingQty[line.id] ?? line.planned_qty
        if (storageDirty) {
          const zoneId = pendingStorage[line.id] ?? ''
          const selectedZone = storageZones.find((z) => z.id === zoneId)
          payload.storage_zone_id = zoneId || null
          payload.storage_zone_name = selectedZone?.name ?? null
        }
        await updateReceiptLine(docId, line.id, payload)
      }
      setMetaDirty(false)
      setPendingQty({})
      setPendingStorage({})
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

  function handleResetChanges() {
    setSupplierName(doc.supplier_name ?? '')
    setArrivalDate(doc.arrival_date ?? '')
    setLogisticsCost(doc.logistics_cost ? String(doc.logistics_cost) : '')
    setMetaDirty(false)
    setPendingQty({})
    setPendingStorage({})
    setMetaError('')
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

  const totalQty = lines.reduce((s, l) => s + plannedQtyFor(l.id), 0)
  const totalAccepted = lines.reduce((s, l) => s + acceptedFor(l.id), 0)
  const totalSku = new Set(lines.map((l) => l.product_sku)).size
  const missingStorageCount = lines.filter((l) => !storageZoneFor(l.id)).length
  const hasPendingStorage = Object.keys(pendingStorage).some(
    (id) => pendingStorage[id] !== (lines.find((l) => l.id === id)?.storage_zone_id ?? ''),
  )

  const today = new Date().toISOString().slice(0, 10)
  const readyChecks = [
    { ok: !!arrivalDate, label: 'Дата прибытия указана', error: 'Не указана дата прибытия' },
    { ok: !arrivalDate || arrivalDate <= today, label: 'Дата прибытия наступила', error: 'Дата прибытия ещё не наступила' },
    { ok: lines.length > 0, label: `Строк: ${lines.length}`, error: 'Нет строк в документе' },
    { ok: lines.length > 0 && lines.every((l) => plannedQtyFor(l.id) >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
    { ok: lines.length > 0 && missingStorageCount === 0, label: 'Место (на проверке) указано по всем строкам', error: `Не указано место (на проверке): ${missingStorageCount}` },
    { ok: lines.length > 0 && lines.every((l) => acceptedFor(l.id) >= 0), label: 'Принят указан по всем строкам', error: 'Укажите принятое количество по всем строкам' },
    { ok: !!logisticsCost && parseFloat(logisticsCost) >= 0, label: 'Стоимость логистики указана', error: 'Не указана стоимость логистики' },
  ]

  const hasPendingQty = Object.keys(pendingQty).some((id) => pendingQty[id] !== lines.find((l) => l.id === id)?.planned_qty)
  const hasUnsavedChanges = metaDirty || hasPendingQty || hasPendingStorage
  const pendingLinesCount = lines.filter((line) => {
    const qtyDirty = pendingQty[line.id] !== undefined && pendingQty[line.id] !== line.planned_qty
    const storageDirty = pendingStorage[line.id] !== undefined && pendingStorage[line.id] !== (line.storage_zone_id ?? '')
    return qtyDirty || storageDirty
  }).length

  const blockReasons = readyChecks.filter((c) => !c.ok).map((c) => c.error)

  async function handleArrive() {
    if (hasUnsavedChanges) {
      const ok = await handleSaveChanges()
      if (!ok) return
    }
    onArrive(lines.map((l) => ({ line_id: l.id, accepted_qty: acceptedFor(l.id) })))
  }

  return (
    <div className="page">
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="detail-status-row">
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/receipts')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge tone="info" dot>{RECEIPT_STATUS_LABELS['planned']}</Badge>
            <span className="detail-meta">
              {doc.doc_number} · {doc.client_name ?? '—'}
            </span>
          </div>
          <div className="page-title">{doc.doc_number}</div>
        </div>
        <div className="detail-actions">
          <div className="detail-actions-row">
            <button className="btn ghost danger" onClick={onCancel} disabled={advancing}>
              <Icon name="x" size={14} />Аннулировать
            </button>
            {hasUnsavedChanges && (
              <button className="btn ghost" onClick={handleResetChanges} disabled={metaSaving}>
                <Icon name="x" size={14} />Отменить изменения
              </button>
            )}
            {hasUnsavedChanges && (
              <button className="btn" onClick={handleSaveChanges} disabled={metaSaving}>
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
            <div className="block-reasons">
              {blockReasons.map((r, i) => <div key={i}>· {r}</div>)}
            </div>
          )}
          {hasUnsavedChanges && (
            <div className="block-reasons">
              · Несохранено: {metaDirty ? 'реквизиты' : ''}{metaDirty && pendingLinesCount > 0 ? ', ' : ''}{pendingLinesCount > 0 ? `строки (${pendingLinesCount})` : ''}
            </div>
          )}
        </div>
      </div>

      <ReceiptStepper status="planned" ops={detail.ops} style={{ marginTop: -10 }} />

      {metaError && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{metaError}</Alert>
      )}

      <div className="split-360">
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
              <Icon name="boxes" size={15} className="ic-accent" />
              <span className="card-head-title">Товары</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{lines.length}</Badge>
              <div className="flex-1" />
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
                    <th style={{ width: 170 }}>Место (на проверке)</th>
                    <th style={{ width: 148 }}>План, шт</th>
                    <th style={{ width: 148 }}>Принят, шт</th>
                    <th style={{ width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const displayQty = plannedQtyFor(l.id)
                    const isDirty = pendingQty[l.id] !== undefined && pendingQty[l.id] !== l.planned_qty
                    const storageDirty = pendingStorage[l.id] !== undefined && pendingStorage[l.id] !== (l.storage_zone_id ?? '')
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
                                disabled={metaSaving || storageZones.length === 0}
                                clearable
                              />
                            </div>
                            <span style={{ display: 'inline-flex', width: 28, color: 'var(--c-accent)', visibility: storageDirty ? 'visible' : 'hidden' }}>
                              <Icon name="edit" size={13} />
                            </span>
                          </div>
                        </Td>
                        <Td>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <NumberStep
                              value={displayQty}
                              onChange={(v) => setPendingQtyFor(l.id, Math.max(1, v))}
                              tone={isDirty ? 'accent' : 'normal'}
                              disabled={metaSaving}
                              width={120}
                            />
                            <span style={{ display: 'inline-flex', width: 28, color: 'var(--c-accent)', visibility: isDirty ? 'visible' : 'hidden' }}>
                              <Icon name="edit" size={13} />
                            </span>
                          </div>
                        </Td>
                        <Td>
                          <NumberStep
                            value={acceptedFor(l.id)}
                            onChange={(v) => setAccepted((prev) => ({ ...prev, [l.id]: Math.max(0, v) }))}
                            disabled={metaSaving}
                            width={120}
                          />
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
                    <td colSpan={5}>Итого: {totalSku} SKU</td>
                    <td className="num">{totalQty}</td>
                    <td className="num">{totalAccepted}</td>
                    <td />
                  </tr>
                </tfoot>
              </Table>
            )}
          </Card>
        </div>

        {/* Правая колонка */}
        <div className="col gap-16">
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
              <span className="key">Принят, шт</span>
              <span className="val mono" style={{ fontWeight: 500, fontSize: 14 }}>{totalAccepted}</span>
            </div>
          </Card>

          {/* Журнал операций */}
          <div className="card ops-card">
            <div className="card-head">
              <Icon name="layers" size={15} className="ic-accent" />
              <span className="card-head-title">Журнал операций</span>
              <Badge tone="accent" style={{ marginLeft: 6 } as React.CSSProperties}>{detail.ops.length}</Badge>
            </div>
            <div className="ops-card-body">
              {detail.ops.length === 0 ? (
                <div className="ops-card-empty">Нет операций</div>
              ) : (
                <div className="ops-timeline">
                  {detail.ops.map((op) => (
                    <OpEntry key={op.id} op={op} onFilterLine={() => {}} />
                  ))}
                </div>
              )}
            </div>
            <div className="ops-card-foot">
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
