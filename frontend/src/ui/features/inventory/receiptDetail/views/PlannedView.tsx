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
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { Drawer } from '../../../../feedback/Drawer'
import { Alert } from '../../../../primitives/Alert'
import { Badge } from '../../../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../../../primitives/Card'
import { DatePicker } from '../../../../primitives/DatePicker'
import { Icon } from '../../../../primitives/Icon'
import { localTodayYmd } from '../../../../../utils/format'
import { useLookups } from '../../../../../hooks/useLookups'
import { ReceiptStepper } from '../../ReceiptStepper'
import { AddLineDrawer } from '../components/AddLineDrawer'
import { OpEntry } from '../components/OpEntry'
import { ReceiptLinesTable } from '../components/ReceiptLinesTable'

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
  const [comment, setComment] = useState(doc.comment ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost ? String(doc.logistics_cost) : '')

  const [metaDirty, setMetaDirty] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)

  const [pendingQty, setPendingQty] = useState<Record<string, number>>({})
  const [pendingStorage, setPendingStorage] = useState<Record<string, string>>({})
  const [accepted, setAccepted] = useState<Record<string, number>>({})
  const [showAddLine, setShowAddLine] = useState(false)

  // «Принят» вводится при фиксации прибытия. Предзаполняем планом как наиболее частым значением.
  function plannedQtyFor(lineId: string): number {
    const line = lines.find((l) => l.id === lineId)
    return pendingQty[lineId] ?? line?.planned_qty ?? 0
  }

  function acceptedBaseline(line: { id: string; accepted_qty?: number | null; planned_qty: number }): number {
    return line.accepted_qty ?? plannedQtyFor(line.id)
  }

  function acceptedFor(lineId: string): number {
    const line = lines.find((l) => l.id === lineId)
    return accepted[lineId] ?? (line ? acceptedBaseline(line) : 0)
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
          comment: comment.trim() || null,
          logistics_cost: logisticsCost ? parseFloat(logisticsCost) : null,
        })
      }
      for (const line of lines) {
        const qtyDirty = pendingQty[line.id] !== undefined && pendingQty[line.id] !== line.planned_qty
        const storageDirty = pendingStorage[line.id] !== undefined && pendingStorage[line.id] !== (line.storage_zone_id ?? '')
        const acceptedDirty = accepted[line.id] !== undefined && accepted[line.id] !== acceptedBaseline(line)
        if (!qtyDirty && !storageDirty && !acceptedDirty) continue

        const payload: ReceiptLineUpdatePayload = {}
        if (qtyDirty) payload.planned_qty = pendingQty[line.id] ?? line.planned_qty
        if (acceptedDirty) payload.accepted_qty = accepted[line.id]
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
      setAccepted({})
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

  const today = localTodayYmd()
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
  const hasPendingAccepted = Object.keys(accepted).some((id) => {
    const line = lines.find((l) => l.id === id)
    return line !== undefined && accepted[id] !== acceptedBaseline(line)
  })
  const hasUnsavedChanges = metaDirty || hasPendingQty || hasPendingStorage || hasPendingAccepted
  const pendingLinesCount = lines.filter((line) => {
    const qtyDirty = pendingQty[line.id] !== undefined && pendingQty[line.id] !== line.planned_qty
    const storageDirty = pendingStorage[line.id] !== undefined && pendingStorage[line.id] !== (line.storage_zone_id ?? '')
    const acceptedDirty = accepted[line.id] !== undefined && accepted[line.id] !== acceptedBaseline(line)
    return qtyDirty || storageDirty || acceptedDirty
  }).length

  const blockReasons = readyChecks.filter((c) => !c.ok).map((c) => c.error)

  async function handleArrive() {
    const arrivalLines = lines.map((l) => ({ line_id: l.id, accepted_qty: acceptedFor(l.id) }))
    if (hasUnsavedChanges) {
      const ok = await handleSaveChanges()
      if (!ok) return
    }
    onArrive(arrivalLines)
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
            <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
              <Icon name="layers" size={14} />Журнал
              {detail.ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({detail.ops.length})</span>}
            </button>
            <button className="btn ghost danger" onClick={onCancel} disabled={advancing}>
              <Icon name="x" size={14} />Аннулировать
            </button>
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
                  <input className="input" value={doc.client_name || '—'} readOnly style={{ cursor: 'default' }} />
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
                    onChange={(e) => { setComment(e.target.value); markDirty() }}
                    style={{ resize: 'vertical', minHeight: 76 }}
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Строки */}
          <Card>
            <CardHead>
              <Icon name="boxes" size={15} className="ic-accent" />
              <span className="card-head-title">Товары к приемке</span>
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
              <ReceiptLinesTable
                stage="planned"
                lines={lines}
                zones={storageZones}
                saving={metaSaving}
                plannedQty={(l) => plannedQtyFor(l.id)}
                plannedDirty={(l) => pendingQty[l.id] !== undefined && pendingQty[l.id] !== l.planned_qty}
                onPlannedQty={(l, v) => setPendingQtyFor(l.id, v)}
                accepted={(l) => acceptedFor(l.id)}
                onAccepted={(l, v) => setAccepted((prev) => ({ ...prev, [l.id]: v }))}
                storageValue={(l) => pendingStorage[l.id] ?? l.storage_zone_id ?? ''}
                onStorage={(l, v) => setPendingStorage((prev) => ({ ...prev, [l.id]: v }))}
                onDelete={(l) => void handleDeleteLine(l.id, l.product_name)}
              />
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

        </div>
      </div>

      <Drawer
        open={opsDrawerOpen}
        onClose={() => setOpsDrawerOpen(false)}
        title="Журнал операций"
        subtitle={`${detail.ops.length} записей · ${doc.doc_number}`}
        width={460}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--c-text-subtle)' }}>
            <Icon name="shield" size={11} />
            <span>Операции не редактируются. Удаление запрещено.</span>
          </div>
        }
      >
        {detail.ops.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
            Нет операций
          </div>
        ) : (
          <div className="ops-timeline">
            {detail.ops.map((op) => (
              <OpEntry key={op.id} op={op} onFilterLine={() => {}} />
            ))}
          </div>
        )}
      </Drawer>

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
