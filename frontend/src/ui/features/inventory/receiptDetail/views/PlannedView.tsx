import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RECEIPT_STATUS_LABELS,
  deleteReceiptLine,
  receiptStatusTone,
  updateReceipt,
  updateReceiptLine,
} from '../../../../../api/receiptsApi'
import type { ReceiptDetail } from '../../../../../api/receiptsApi'
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { Drawer } from '../../../../feedback/Drawer'
import { Alert } from '../../../../primitives/Alert'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { DatePicker } from '../../../../primitives/DatePicker'
import { EmptyState } from '../../../../primitives/EmptyState'
import { Icon } from '../../../../primitives/Icon'
import { AutoGrowTextarea, Field, Input } from '../../../../primitives/Input'
import { fmtDate } from '../../../../../utils/format'
import { canViewCosts, canEditPlannedArrival } from '../../../../../utils/access'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { DocHeader } from '../../../shared/process/DocHeader'
import { Panel, ReadRow } from '../../../shared/process/processUI'
import { receiptStatusRole } from '../shared/receiptProcess'
import { AddLineDrawer } from '../components/AddLineDrawer'
import { OpEntry } from '../components/OpEntry'
import { ReceiptLinesTable } from '../components/ReceiptLinesTable'
import { ReceiptRailPanel } from '../components/ReceiptRailPanel'

type Props = {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onCancel: () => void
  advancing: boolean
}

/** План поступления в статусе «В плане»: редактирование плана и ожидание приёмки
 *  рейсом. Карточной приёмки больше нет — приёмка идёт при разгрузке рейса. */
export function PlannedView({ docId, detail, onReload, onCancel, advancing }: Props) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { doc, lines } = detail
  const status = doc.status
  const hasTrip = !!doc.trip_id

  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canEditPlan = canEditPlannedArrival(user)

  const [arrivalDate, setArrivalDate] = useState(doc.arrival_date ?? '')
  const [comment, setComment] = useState(doc.comment ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost != null ? String(doc.logistics_cost) : '')
  const [pendingQty, setPendingQty] = useState<Record<string, number>>({})

  const [metaDirty, setMetaDirty] = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [metaError, setMetaError] = useState('')
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)
  const [showAddLine, setShowAddLine] = useState(false)

  function markDirty() { setMetaDirty(true) }
  function plannedQtyFor(lineId: string): number {
    const line = lines.find((l) => l.id === lineId)
    return pendingQty[lineId] ?? line?.planned_qty ?? 0
  }

  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0
  const hasPendingQty = Object.keys(pendingQty).some((id) => pendingQty[id] !== lines.find((l) => l.id === id)?.planned_qty)
  const hasUnsavedChanges = metaDirty || hasPendingQty

  const totalQty = lines.reduce((s, l) => s + plannedQtyFor(l.id), 0)
  const totalSku = new Set(lines.map((l) => l.product_sku)).size

  async function handleSaveChanges(): Promise<boolean> {
    if (!hasUnsavedChanges) return true
    setMetaError('')
    setMetaSaving(true)
    try {
      if (metaDirty) {
        await updateReceipt(docId, {
          ...(canEditPlan ? { arrival_date: arrivalDate || null } : {}),
          comment: comment.trim() || null,
          ...(showCosts ? { logistics_cost: logisticsCostFilled ? logisticsCostNumber : null } : {}),
        })
      }
      for (const line of lines) {
        if (pendingQty[line.id] !== undefined && pendingQty[line.id] !== line.planned_qty) {
          await updateReceiptLine(docId, line.id, { planned_qty: pendingQty[line.id] })
        }
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

  return (
    <div className="page">
      <DocHeader
        badges={
          <>
            <Badge tone={receiptStatusTone(status) as BadgeTone} dot>{RECEIPT_STATUS_LABELS[status]}</Badge>
            {hasTrip && <Badge tone="info">Ожидает рейс</Badge>}
          </>
        }
        role={receiptStatusRole(status, hasTrip)}
        title={doc.doc_number}
        subtitle={`Поступление · ${doc.client_name ?? '—'}`}
        onBack={() => navigate('/inventory/receipts')}
        actions={
          <>
            <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
              <Icon name="layers" size={14} />Журнал
              {detail.ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({detail.ops.length})</span>}
            </button>
            {!hasTrip && (
              <button className="btn ghost danger" onClick={onCancel} disabled={advancing}>
                <Icon name="x" size={14} />Аннулировать
              </button>
            )}
            {hasUnsavedChanges && (
              <button className="btn" onClick={handleSaveChanges} disabled={metaSaving}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
            {hasTrip && (
              <button className="btn primary" onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}>
                <Icon name="truckIn" size={14} />Открыть рейс {doc.trip_number}
              </button>
            )}
          </>
        }
      />

      <Alert tone={hasTrip ? 'info' : 'warning'} style={{ marginBottom: 16 }}>
        {hasTrip
          ? `Поступление привязано к рейсу ${doc.trip_number}. Приёмка пройдёт при разгрузке рейса — товар встанет на остатки, статус сменится на «Частично принято» или «Завершён».`
          : 'Поступление принимается рейсом. Привяжите его к рейсу в разделе «Логистика → Рейсы» — приёмка пройдёт при разгрузке.'}
      </Alert>

      {metaError && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{metaError}</Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock icon="file" title="Основная информация" role="manager" state="active">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Клиент" style={{ marginBottom: 0 }}>
                <Input value={doc.client_name || '—'} readOnly style={{ cursor: 'default' }} />
              </Field>
              <Field label="Рейс" style={{ marginBottom: 0 }}>
                {doc.trip_id ? (
                  <button className="btn ghost sm" onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}
                    style={{ width: '100%', justifyContent: 'flex-start' }}>
                    <Icon name="truckIn" size={13} />{doc.trip_number}
                  </button>
                ) : (
                  <Input value="—" readOnly style={{ cursor: 'default' }} />
                )}
              </Field>
              <Field label="Дата прибытия (план)" required={canEditPlan} style={{ marginBottom: 0 }}>
                {canEditPlan ? (
                  <DatePicker value={arrivalDate} onChange={(v) => { setArrivalDate(v); markDirty() }} />
                ) : (
                  <Input value={fmtDate(doc.arrival_date) || '—'} readOnly style={{ cursor: 'default' }} />
                )}
              </Field>
              <Field label="Дата прибытия (факт)" hint="из рейса" style={{ marginBottom: 0 }}>
                <Input value={fmtDate(doc.actual_arrival_date) || '—'} readOnly style={{ cursor: 'default' }} />
              </Field>
              {showCosts && (
                <Field label="Стоимость логистики для клиента, ₽" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="0"
                    value={logisticsCost}
                    onChange={(e) => { setLogisticsCost(e.target.value); markDirty() }}
                  />
                </Field>
              )}
              <Field label="Комментарий" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <AutoGrowTextarea
                  minRows={3}
                  placeholder="Примечание для команды склада"
                  value={comment}
                  onChange={(e) => { setComment(e.target.value); markDirty() }}
                  style={{ resize: 'vertical', minHeight: 76 }}
                />
              </Field>
            </div>
          </PhaseBlock>

          <PhaseBlock
            icon="boxes"
            title="Товары к приёмке"
            role="manager"
            state="active"
            hint="План приедет и будет принят рейсом"
            right={
              <button className="btn sm primary" onClick={() => setShowAddLine(true)}>
                <Icon name="plus" size={12} />Добавить строку
              </button>
            }
          >
            {lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState title="Нет строк" sub="Добавьте товары, которые приедут на склад" />
              </div>
            ) : (
              <ReceiptLinesTable
                stage="draft"
                lines={lines}
                saving={metaSaving}
                plannedQty={(l) => plannedQtyFor(l.id)}
                plannedDirty={(l) => pendingQty[l.id] !== undefined && pendingQty[l.id] !== l.planned_qty}
                onPlannedQty={(l, v) => setPendingQty((prev) => ({ ...prev, [l.id]: v }))}
                onDelete={(l) => void handleDeleteLine(l.id, l.product_name)}
              />
            )}
          </PhaseBlock>

          <PhaseBlock
            icon="forklift"
            title="Приёмка рейсом"
            role="warehouse"
            state="locked"
            hint={hasTrip
              ? `Пройдёт при разгрузке рейса ${doc.trip_number}`
              : 'Доступна после привязки поступления к рейсу'}
          >
            <div style={{ padding: '4px 2px', fontSize: 12, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
              Кладовщик посчитает и примет товар в карточке рейса при разгрузке. Принятое
              встанет на остатки «На хранении / Годный».
            </div>
          </PhaseBlock>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReceiptRailPanel
            status={status}
            ops={detail.ops}
            awaitingTrip={hasTrip}
            tripNumber={doc.trip_number}
          />

          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{totalSku}</ReadRow>
              <ReadRow label="Строк" mono>{lines.length}</ReadRow>
              <ReadRow label="План" mono strong>{totalQty} шт</ReadRow>
            </div>
          </Panel>
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
