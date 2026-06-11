import { useState } from 'react'
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
import { DatePicker } from '../../../../primitives/DatePicker'
import { EmptyState } from '../../../../primitives/EmptyState'
import { Icon } from '../../../../primitives/Icon'
import { AutoGrowTextarea, Field, Input } from '../../../../primitives/Input'
import { fmtDate } from '../../../../../utils/format'
import { canViewCosts, canEditPlannedArrival } from '../../../../../utils/access'
import { useLookups } from '../../../../../hooks/useLookups'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { DocHeader } from '../../../shared/process/DocHeader'
import { PrimaryAction } from '../../../shared/process/PrimaryAction'
import { Panel, ReadRow, ChecklistPanel, LockedGrid } from '../../../shared/process/processUI'
import { AddLineDrawer } from '../components/AddLineDrawer'
import { OpEntry } from '../components/OpEntry'
import { ReceiptLinesTable } from '../components/ReceiptLinesTable'
import { ReceiptRailPanel } from '../components/ReceiptRailPanel'

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
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canEditPlan = canEditPlannedArrival(user)
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
          ...(canEditPlan ? { arrival_date: arrivalDate || null } : {}),
          comment: comment.trim() || null,
          ...(showCosts ? { logistics_cost: logisticsCostFilled ? logisticsCostNumber : null } : {}),
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
    { ok: !!arrivalDate, label: 'Дата прибытия (план) указана', error: 'Не указана дата прибытия (план)' },
    { ok: lines.length > 0, label: `Строк добавлено: ${lines.length}`, error: 'Не добавлено ни одной строки' },
    { ok: lines.length > 0 && lines.every((l) => l.planned_qty >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
  ]

  const blockReasons = [
    ...(hasUnsavedChanges ? ['Есть несохранённые изменения'] : []),
    ...readyChecks.filter((c) => !c.ok).map((c) => c.error),
  ]

  return (
    <div className="page">
      <DocHeader
        badges={<Badge dot>{RECEIPT_STATUS_LABELS['draft']}</Badge>}
        role="manager"
        title={doc.doc_number}
        subtitle={`Поступление · создано ${fmtDate(doc.created_at)}${doc.created_by ? ` · ${doc.created_by}` : ''}`}
        onBack={() => navigate('/inventory/receipts')}
        blockReasons={showBlockReasons ? blockReasons : []}
        actions={
          <>
            <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
              <Icon name="layers" size={14} />Журнал
              {detail.ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({detail.ops.length})</span>}
            </button>
            {hasUnsavedChanges && (
              <button className="btn" onClick={handleSaveChanges} disabled={metaSaving || !clientId}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
            <PrimaryAction
              icon="arrowRight"
              label="Запланировать поступление"
              hint="уйдёт в план склада — статус «В плане»"
              disabled={advancing}
              onClick={() => { if (blockReasons.length > 0) { setShowBlockReasons(true) } else { onAdvance() } }}
            />
          </>
        }
      />

      {metaError && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{metaError}</Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        {/* Left — фазы */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock icon="file" title="Основная информация" role="manager" state="active"
            hint="Клиент и план поступления">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Клиент" required style={{ marginBottom: 0 }}>
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
              <Field label="Дата прибытия (факт)" style={{ marginBottom: 0 }}>
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

          <PhaseBlock icon="boxes" title="Товары к приёмке" role="manager" state="active"
            hint="План — что и сколько приедет на склад"
            right={
              <button className="btn sm primary" onClick={() => setShowAddLine(true)} disabled={!clientId}>
                <Icon name="plus" size={12} />Добавить строку
              </button>
            }
          >
            {lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState
                  title="Нет строк"
                  sub={clientId ? 'Нажмите «Добавить строку» для выбора товара' : 'Сначала выберите клиента'}
                />
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
          </PhaseBlock>

          <PhaseBlock icon="forklift" title="Приёмка" role="warehouse" state="locked"
            hint="Кладовщик примет товар после прибытия">
            <LockedGrid labels={['Дата прибытия (факт)', 'Принято', 'Местоположения']} />
          </PhaseBlock>
        </div>

        {/* Right — маршрут + готовность + итоги */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReceiptRailPanel status="draft" ops={detail.ops} />
          <ChecklistPanel items={readyChecks.map((c) => ({ ok: c.ok, label: c.label }))} />
          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{totalSku}</ReadRow>
              <ReadRow label="Строк" mono>{lines.length}</ReadRow>
              <ReadRow label="План" mono strong>{totalQty} шт</ReadRow>
            </div>
          </Panel>
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
