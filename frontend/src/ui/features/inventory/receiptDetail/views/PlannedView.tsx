import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RECEIPT_STATUS_LABELS,
  deleteReceiptLine,
  receiptStatusTone,
  updateReceipt,
  updateReceiptActualArrival,
  updateReceiptLine,
} from '../../../../../api/receiptsApi'
import type { ReceiptArriveLine, ReceiptDetail, ReceiptLineUpdatePayload } from '../../../../../api/receiptsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { useConfirm } from '../../../../feedback/ConfirmDialog'
import { Drawer } from '../../../../feedback/Drawer'
import { Alert } from '../../../../primitives/Alert'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { DatePicker } from '../../../../primitives/DatePicker'
import { EmptyState } from '../../../../primitives/EmptyState'
import { Icon } from '../../../../primitives/Icon'
import { AutoGrowTextarea, Field, Input } from '../../../../primitives/Input'
import { fmtDate, localTodayYmd } from '../../../../../utils/format'
import { canViewCosts, canEditPlannedArrival } from '../../../../../utils/access'
import { useLookups } from '../../../../../hooks/useLookups'
import { useCurrentUser } from '../../../../../hooks/useCurrentUser'
import { PhaseBlock } from '../../../shared/process/PhaseBlock'
import { DocHeader } from '../../../shared/process/DocHeader'
import { PrimaryAction } from '../../../shared/process/PrimaryAction'
import { Panel, ReadRow, ChecklistPanel, LockedGrid } from '../../../shared/process/processUI'
import { receiptStatusRole } from '../shared/receiptProcess'
import { AddLineDrawer } from '../components/AddLineDrawer'
import { OpEntry } from '../components/OpEntry'
import { ReceiptLinesTable } from '../components/ReceiptLinesTable'
import { ReceiptRailPanel } from '../components/ReceiptRailPanel'

type Props = {
  docId: string
  detail: ReceiptDetail
  onReload: () => Promise<void>
  onArrive: (lines: ReceiptArriveLine[]) => void
  onStartIntake: () => void
  onCancel: () => void
  advancing: boolean
}

export function PlannedView({
  docId,
  detail,
  onReload,
  onArrive,
  onStartIntake,
  onCancel,
  advancing,
}: Props) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { doc, lines } = detail
  const status = doc.status

  const [arrivalDate, setArrivalDate] = useState(doc.arrival_date ?? '')
  const [actualArrivalDate, setActualArrivalDate] = useState(doc.actual_arrival_date ?? '')
  const [comment, setComment] = useState(doc.comment ?? '')
  const [logisticsCost, setLogisticsCost] = useState(doc.logistics_cost != null ? String(doc.logistics_cost) : '')

  const isPlanned = status === 'planned'
  const isIntake = status === 'on_intake'
  const hasTrip = !!doc.trip_id
  const awaitingTrip = isPlanned && hasTrip
  const actualDirty = actualArrivalDate !== (doc.actual_arrival_date ?? '')

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

  const { unloadingZones: zonesAll } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canEditPlan = canEditPlannedArrival(user)
  const storageZones: DictionaryItem[] = zonesAll.filter((z) => z.is_active && !z.is_deleted)

  function markDirty() { setMetaDirty(true) }

  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0

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
      if (!hasTrip && actualDirty) {
        await updateReceiptActualArrival(docId, actualArrivalDate || null)
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
    { ok: !!arrivalDate, label: 'Дата прибытия (план) указана', error: 'Не указана дата прибытия (план)' },
    { ok: !arrivalDate || arrivalDate <= today, label: 'Дата прибытия (план) наступила', error: 'Дата прибытия (план) ещё не наступила' },
    ...(isPlanned ? [{ ok: hasTrip ? !!doc.actual_arrival_date : !!actualArrivalDate, label: 'Дата прибытия (факт) указана', error: 'Не указана дата прибытия (факт)' }] : []),
    { ok: lines.length > 0, label: `Строк: ${lines.length}`, error: 'Нет строк в документе' },
    { ok: lines.length > 0 && lines.every((l) => plannedQtyFor(l.id) >= 1), label: 'Все строки валидны (≥ 1 шт)', error: 'Есть строки с количеством меньше 1' },
    { ok: lines.length > 0 && missingStorageCount === 0, label: 'Местоположение указано по всем строкам', error: `Не указано местоположение: ${missingStorageCount}` },
    { ok: lines.length > 0 && lines.every((l) => acceptedFor(l.id) >= 0), label: 'Принят указан по всем строкам', error: 'Укажите принятое количество по всем строкам' },
    ...(showCosts ? [{ ok: logisticsCostFilled, label: 'Стоимость логистики для клиента указана', error: 'Не указана стоимость логистики для клиента' }] : []),
  ]

  const hasPendingQty = Object.keys(pendingQty).some((id) => pendingQty[id] !== lines.find((l) => l.id === id)?.planned_qty)
  const hasPendingAccepted = Object.keys(accepted).some((id) => {
    const line = lines.find((l) => l.id === id)
    return line !== undefined && accepted[id] !== acceptedBaseline(line)
  })
  const hasUnsavedChanges = metaDirty || (!hasTrip && actualDirty) || hasPendingQty || hasPendingStorage || hasPendingAccepted

  const blockReasons = readyChecks.filter((c) => !c.ok).map((c) => c.error)

  async function handleArrive() {
    const arrivalLines = lines.map((l) => ({ line_id: l.id, accepted_qty: acceptedFor(l.id) }))
    if (hasUnsavedChanges) {
      const ok = await handleSaveChanges()
      if (!ok) return
    }
    onArrive(arrivalLines)
  }

  async function handleStartIntake() {
    if (hasUnsavedChanges) {
      const ok = await handleSaveChanges()
      if (!ok) return
    }
    onStartIntake()
  }

  function runPrimary() {
    if (awaitingTrip) return
    if (blockReasons.length > 0) { setShowBlockReasons(true); return }
    if (isPlanned) void handleStartIntake()
    else void handleArrive()
  }

  return (
    <div className="page">
      <DocHeader
        badges={
          <>
            <Badge tone={receiptStatusTone(status) as BadgeTone} dot>{RECEIPT_STATUS_LABELS[status]}</Badge>
            {awaitingTrip && <Badge tone="info">Ожидает рейс</Badge>}
          </>
        }
        role={receiptStatusRole(status, awaitingTrip)}
        title={doc.doc_number}
        subtitle={`Поступление · ${doc.client_name ?? '—'}`}
        onBack={() => navigate('/inventory/receipts')}
        blockReasons={!awaitingTrip && showBlockReasons ? blockReasons : []}
        actions={
          <>
            <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
              <Icon name="layers" size={14} />Журнал
              {detail.ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({detail.ops.length})</span>}
            </button>
            {isPlanned && !awaitingTrip && (
              <button className="btn ghost danger" onClick={onCancel} disabled={advancing}>
                <Icon name="x" size={14} />Аннулировать
              </button>
            )}
            {hasUnsavedChanges && (
              <button className="btn" onClick={handleSaveChanges} disabled={metaSaving}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
            {awaitingTrip ? (
              <button className="btn" onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}>
                <Icon name="truckIn" size={14} />Открыть рейс {doc.trip_number}
              </button>
            ) : (
              <PrimaryAction
                icon={isPlanned ? 'forklift' : 'check'}
                label={isPlanned ? 'Начать приёмку' : 'Принять товары'}
                hint={isPlanned
                  ? 'кладовщик начнёт подсчёт — статус «На приемке»'
                  : 'товар встанет на остатки годным — статус «Завершён»'}
                disabled={advancing}
                onClick={runPrimary}
              />
            )}
          </>
        }
      />

      {awaitingTrip && (
        <Alert tone="warning" style={{ marginBottom: 16 }}>
          Поступление привязано к рейсу {doc.trip_number}. Приёмка начнётся автоматически
          при завершении разгрузки рейса, дата прибытия (факт) проставится из рейса.
        </Alert>
      )}

      {metaError && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{metaError}</Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        {/* Left — фазы */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock
            icon="file"
            title="Основная информация"
            role="manager"
            state={isPlanned ? 'active' : 'done'}
            hint={isPlanned ? 'Даты и логистика — до начала приёмки' : undefined}
          >
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
              <Field
                label="Дата прибытия (факт)"
                required={isPlanned && !hasTrip}
                hint={hasTrip ? 'из рейса' : undefined}
                style={{ marginBottom: 0 }}
              >
                {hasTrip ? (
                  <Input value={fmtDate(doc.actual_arrival_date) || '—'} readOnly style={{ cursor: 'default' }} />
                ) : (
                  <DatePicker value={actualArrivalDate} onChange={setActualArrivalDate} />
                )}
              </Field>
              {showCosts && (
                <Field label="Стоимость логистики для клиента, ₽" required style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
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
            icon={isIntake ? 'forklift' : 'boxes'}
            title={isIntake ? 'Приёмка товаров' : 'Товары к приёмке'}
            role={isIntake ? 'warehouse' : 'manager'}
            state="active"
            hint={isIntake
              ? '«Принят» и местоположение — по каждой строке'
              : awaitingTrip
                ? 'План можно править до разгрузки рейса'
                : 'План, местоположения и принятое количество'}
            right={isPlanned ? (
              <button className="btn sm primary" onClick={() => setShowAddLine(true)}>
                <Icon name="plus" size={12} />Добавить строку
              </button>
            ) : undefined}
          >
            {lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState title="Нет строк" sub="Добавьте товары, которые приедут на склад" />
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
          </PhaseBlock>

          {isPlanned && (
            <PhaseBlock
              icon="forklift"
              title="Приёмка"
              role="warehouse"
              state="locked"
              hint={awaitingTrip
                ? `Начнётся автоматически при разгрузке рейса ${doc.trip_number}`
                : 'Кладовщик начнёт приёмку после прибытия товара'}
            >
              <LockedGrid labels={['Принято', 'Местоположения']} />
            </PhaseBlock>
          )}
        </div>

        {/* Right — маршрут + контекстные панели */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ReceiptRailPanel
            status={status}
            ops={detail.ops}
            awaitingTrip={awaitingTrip}
            tripNumber={doc.trip_number}
          />

          {!awaitingTrip && (
            <ChecklistPanel items={readyChecks.map((c) => ({ ok: c.ok, label: c.label }))} />
          )}

          {hasTrip && (
            <Panel icon="truckIn" title="Рейс прибытия">
              <button
                className="btn ghost sm"
                onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                <Icon name="truckIn" size={13} />{doc.trip_number}
              </button>
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
                {isPlanned
                  ? 'Дата прибытия (факт) и старт приёмки проставляются при разгрузке рейса.'
                  : 'Приёмка начата разгрузкой рейса.'}
              </div>
            </Panel>
          )}

          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{totalSku}</ReadRow>
              <ReadRow label="Строк" mono>{lines.length}</ReadRow>
              <ReadRow label="План" mono strong>{totalQty} шт</ReadRow>
              <ReadRow label="Принят" mono strong>{totalAccepted} шт</ReadRow>
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
