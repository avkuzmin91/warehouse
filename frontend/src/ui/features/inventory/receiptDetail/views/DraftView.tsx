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
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { Drawer } from '../../../../feedback/Drawer'
import { Alert } from '../../../../primitives/Alert'
import { Badge } from '../../../../primitives/Badge'
import { Card, CardBody, CardHead } from '../../../../primitives/Card'
import { DatePicker } from '../../../../primitives/DatePicker'
import { Icon } from '../../../../primitives/Icon'
import { fmtDate } from '../../../../../utils/format'
import { useLookups } from '../../../../../hooks/useLookups'
import { ReceiptStepper } from '../../ReceiptStepper'
import { AddLineDrawer } from '../components/AddLineDrawer'
import { OpEntry } from '../components/OpEntry'
import { ReceiptLinesTable } from '../components/ReceiptLinesTable'

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
  const [arrivalDate, setArrivalDate] = useState(doc.arrival_date ?? '')
  const [comment, setComment] = useState(doc.comment ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost != null ? String(doc.logistics_cost) : '')

  const [metaDirty, setMetaDirty] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)

  const [pendingQty, setPendingQty] = useState<Record<string, number>>({})

  const [showAddLine, setShowAddLine] = useState(false)

  const { clients: clientsAll } = useLookups()
  const clients: DictionaryItem[] = clientsAll.filter((c) => c.is_active && !c.is_deleted)

  function markDirty() { setMetaDirty(true) }

  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0

  const hasPendingQty = Object.keys(pendingQty).some((id) => pendingQty[id] !== lines.find((l) => l.id === id)?.planned_qty)
  const hasUnsavedChanges = metaDirty || hasPendingQty

  async function handleSaveChanges(): Promise<boolean> {
    if (!hasUnsavedChanges) return true
    setMetaError('')
    setMetaSaving(true)
    try {
      if (metaDirty) {
        await updateReceipt(docId, {
          client_id: clientId || undefined,
          arrival_date: arrivalDate || null,
          comment: comment.trim() || null,
          logistics_cost: logisticsCostFilled ? logisticsCostNumber : null,
        })
      }
      for (const line of lines) {
        const qty = pendingQty[line.id]
        if (qty === undefined || qty === line.planned_qty) continue
        await updateReceiptLine(docId, line.id, qty)
      }
      setMetaDirty(false)
      setPendingQty({})
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
    ...(hasUnsavedChanges ? ['Есть несохранённые изменения'] : []),
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
            <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
              <Icon name="layers" size={14} />Журнал
              {detail.ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({detail.ops.length})</span>}
            </button>
            {hasUnsavedChanges && (
              <button className="btn" onClick={handleSaveChanges} disabled={metaSaving || !clientId}>
                <Icon name="save" size={14} />Сохранить изменения
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
              <ReceiptLinesTable
                stage="draft"
                lines={lines}
                saving={metaSaving}
                plannedQty={(l) => pendingQty[l.id] ?? l.planned_qty}
                plannedDirty={(l) => pendingQty[l.id] !== undefined && pendingQty[l.id] !== l.planned_qty}
                onPlannedQty={(l, v) => setPendingQtyFor(l.id, v)}
                onDelete={(l) => void handleDeleteLine(l.id, l.product_name)}
              />
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
    </div>
  )
}
