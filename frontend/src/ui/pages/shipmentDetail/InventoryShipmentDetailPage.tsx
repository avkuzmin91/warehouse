import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getShipment,
  advanceShipment,
  deleteShipment,
  cancelShipment,
  addShipmentLine,
  updateShipmentLine,
  updateShipment,
  deleteShipmentLine,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
} from '../../../api/shipmentsApi'
import type { ShipmentDetail, ShipmentStatus, ShipmentCargoType, ShipmentLine } from '../../../api/shipmentsApi'
import { getBalances, getBalancesByZone } from '../../../api/balancesApi'
import type { BalanceItem, BalanceZoneItem } from '../../../api/balancesApi'
import { ShipmentStepper } from '../../features/inventory/ShipmentStepper'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { Alert } from '../../primitives/Alert'
import { EmptyState } from '../../primitives/EmptyState'
import { Tooltip } from '../../primitives/Tooltip'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { Drawer } from '../../feedback/Drawer'
import { DatePicker } from '../../primitives/DatePicker'
import { Field, Input } from '../../primitives/Input'
import { fmtDateLong } from '../../../utils/format'
import { balanceKey } from '../../../utils/balanceKey'
import { canViewCosts } from '../../../utils/access'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { BalancePicker } from '../../features/inventory/shared/BalancePicker'
import { NumberStep } from '../../features/inventory/shared/NumberStep'
import { CargoTypeDisplay } from './components/CargoTypeDisplay'
import { OpEntry } from './components/OpEntry'
import { lineAvailable } from './shared/opLabels'
import { Table, Td } from '../../data/Table'
import { LineIdentityCell } from '../../features/inventory/receiptDetail/components/LineIdentityCell'
import { ZoneCell } from '../../features/inventory/receiptDetail/components/ZoneCell'

type EditableShipmentLine = ShipmentLine & { _key: string; available: number }
type LineDraft = { qty: number; shippedQty: number; zoneId: string; zoneName: string | null }
type ZoneChoice = { id: string; name: string; sub?: string }
type ReadinessCheck = { ok: boolean; label: string; error: string }

export function InventoryShipmentDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [zoneBalances, setZoneBalances] = useState<BalanceZoneItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const [infoClientId, setInfoClientId] = useState<string | null>(null)
  const [infoClientName, setInfoClientName] = useState<string | null>(null)
  const [infoShipDate, setInfoShipDate] = useState('')
  const [infoLogisticsCost, setInfoLogisticsCost] = useState('')
  const [infoComment, setInfoComment] = useState('')
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoSaved, setInfoSaved] = useState(false)
  const [infoDirty, setInfoDirty] = useState(false)

  useEffect(() => {
    if (!doc) return
    setInfoClientId(doc.client_id ?? null)
    setInfoClientName(doc.client_name ?? null)
    setInfoShipDate(doc.ship_date ?? '')
    setInfoLogisticsCost(doc.logistics_cost != null ? String(doc.logistics_cost) : '')
    setInfoComment(doc.comment ?? '')
    setInfoDirty(false)
  }, [doc])

  const load = useCallback(async () => {
    if (!docId) return
    setLoading(true)
    try {
      setDoc(await getShipment(docId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => { load() }, [load])

  async function handleInfoSave() {
    if (!docId) return false
    setInfoSaving(true)
    setError('')
    try {
      await updateShipment(docId, {
        client_id:      infoClientId,
        client_name:    infoClientName,
        ship_date:      infoShipDate || null,
        ...(showCosts ? { logistics_cost: infoLogisticsCost ? parseFloat(infoLogisticsCost) : null } : {}),
        comment:        infoComment.trim() || null,
      })
      await load()
      setInfoDirty(false)
      setInfoSaved(true)
      setTimeout(() => setInfoSaved(false), 2000)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
      return false
    } finally {
      setInfoSaving(false)
    }
  }

  const status = doc?.status as ShipmentStatus | undefined
  const isPlanned = status === 'packing'
  const isDraft = status === 'draft'
  const canDelete = isDraft || isPlanned
  const canEditPlan = isDraft || isPlanned
  const canEditShipped = isPlanned
  const canEditInfo = isDraft || isPlanned

  const shipmentClientId = doc?.client_id ?? null
  const shipmentCargoType = doc?.cargo_type

  const loadBalances = useCallback(async () => {
    if (!shipmentClientId || !canDelete) {
      setBalances([])
      setZoneBalances([])
      return
    }
    const balanceParams = {
      limit: 200,
      only_positive: true,
      client_id: shipmentClientId,
      has_defect: shipmentCargoType === 'defect' ? true : undefined,
    }
    const res = await getBalances(balanceParams)
    setBalances(res.items.filter((b) => shipmentCargoType === 'defect' ? b.defect > 0 : b.good + b.on_review > 0))
    const zonesRes = await getBalancesByZone({
      client_id: shipmentClientId,
      only_positive: true,
    })
    setZoneBalances(zonesRes.items.filter((item) => item.status === shipmentCargoType))
  }, [shipmentClientId, shipmentCargoType, canDelete])

  useEffect(() => {
    loadBalances().catch(() => {})
  }, [loadBalances])

  useEffect(() => {
    if (!doc) {
      setDrafts({})
      return
    }
    setDrafts((prev) => {
      const next: Record<string, LineDraft> = {}
      for (const line of doc.lines) {
        next[line.id] = prev[line.id] ?? {
          qty:        line.qty,
          shippedQty: line.shipped_qty,
          zoneId:     line.storage_zone_id ?? '',
          zoneName:   line.storage_zone_name ?? null,
        }
      }
      return next
    })
  }, [doc])

  async function act(fn: () => Promise<unknown>, redirectAfter?: string) {
    setActing(true)
    setError('')
    try {
      await fn()
      if (redirectAfter) navigate(redirectAfter)
      else await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setActing(false)
    }
  }

  const editableLines: EditableShipmentLine[] = doc
    ? doc.lines.map((line) => ({
        ...line,
        _key: balanceKey(line),
        available: lineAvailable(line, balances, doc.cargo_type as ShipmentCargoType),
      }))
    : []

  function getDraft(line: ShipmentLine): LineDraft {
    return drafts[line.id] ?? {
      qty:        line.qty,
      shippedQty: line.shipped_qty,
      zoneId:     line.storage_zone_id ?? '',
      zoneName:   line.storage_zone_name ?? null,
    }
  }

  function getDraftAvailable(line: ShipmentLine): number {
    const draft = getDraft(line)
    const zoneId = draft.zoneId || null
    const matched = zoneBalances.find((item) =>
      balanceKey(item) === balanceKey(line)
      && item.location_id === zoneId
      && item.client_id === shipmentClientId
    )
    return matched?.qty ?? 0
  }

  function getLineZoneOptions(line: ShipmentLine): ZoneChoice[] {
    return zoneBalances
      .filter((item) =>
        item.location_id
        && item.qty > 0
        && balanceKey(item) === balanceKey(line)
        && item.client_id === shipmentClientId
      )
      .map((item) => ({
        id: item.location_id!,
        name: item.location_name ?? item.location_id!,
        sub: `доступно ${item.qty.toLocaleString('ru-RU')} шт`,
      }))
  }

  function setDraftQty(lineId: string, value: number) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], qty: Math.max(1, Number.isFinite(value) ? value : 1) },
    }))
  }

  function setDraftShippedQty(lineId: string, value: number) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], shippedQty: Math.max(0, Number.isFinite(value) ? value : 0) },
    }))
  }

  function setDraftZone(lineId: string, zoneId: string, zoneName: string | null) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], zoneId, zoneName },
    }))
  }

  const hasUnsavedLineChanges = editableLines.some((line) => {
    const d = getDraft(line)
    return d.qty !== line.qty
      || d.shippedQty !== line.shipped_qty
      || d.zoneId !== (line.storage_zone_id ?? '')
      || d.zoneName !== (line.storage_zone_name ?? null)
  })

  const infoLogisticsNumber = Number(infoLogisticsCost)
  const infoLogisticsFilled = infoLogisticsCost.trim() !== '' && Number.isFinite(infoLogisticsNumber) && infoLogisticsNumber >= 0

  const advanceChecks: ReadinessCheck[] = [
    {
      ok: (doc?.lines.length ?? 0) > 0,
      label: 'Добавлены строки',
      error: 'Добавьте хотя бы одну строку в отгрузку',
    },
    {
      ok: doc?.lines.every((line) => getDraft(line).qty >= 1) ?? false,
      label: 'План заполнен',
      error: 'Проверьте количество: в каждой строке должно быть не меньше 1 шт',
    },
    {
      ok: doc?.lines.every((line) => getDraft(line).shippedQty <= getDraft(line).qty) ?? false,
      label: 'Отгружено не больше плана',
      error: 'Отгруженное количество не должно превышать план',
    },
    ...(isPlanned
      ? [
          {
            ok: !!infoShipDate,
            label: 'Дата отгрузки указана',
            error: 'Укажите дату отгрузки',
          },
          ...(showCosts
            ? [{
                ok: infoLogisticsFilled,
                label: 'Стоимость логистики указана',
                error: 'Укажите стоимость логистики',
              }]
            : []),
          {
            ok: doc?.lines.every((line) => getDraft(line).shippedQty > 0) ?? false,
            label: 'Указано отгруженное количество',
            error: 'Укажите отгруженное количество больше 0 по каждой строке',
          },
        ]
      : []),
    ...(isPlanned
      ? [
          {
            ok: doc?.lines.every((line) => !!getDraft(line).zoneId) ?? false,
            label: 'Выбрано место отгрузки',
            error: 'Выберите место хранения для каждой отгружаемой строки',
          },
          {
            ok: doc?.lines.every((line) => getDraft(line).shippedQty <= getDraftAvailable(line)) ?? false,
            label: 'Достаточно остатка',
            error: 'В выбранном месте недостаточно товара для отгрузки',
          },
        ]
      : []),
  ]
  const advanceBlockReasons = status === 'draft' || status === 'packing'
    ? advanceChecks.filter((check) => !check.ok).map((check) => check.error)
    : []
  const showReadiness = status === 'draft' || status === 'packing'
  const readinessOk = advanceChecks.every((check) => check.ok)
  const plannedUnits = editableLines.reduce((sum, line) => sum + getDraft(line).qty, 0)
  const shippedUnits = editableLines.reduce((sum, line) => sum + getDraft(line).shippedQty, 0)
  const shippedPct = plannedUnits > 0 ? Math.floor((shippedUnits / plannedUnits) * 100) : 0

  async function refreshAfterLineChange() {
    await load()
    await loadBalances()
  }

  async function handleAddLine(item: BalanceItem, qty: number, zoneId: string | null, zoneName: string | null) {
    if (!docId) return
    await act(async () => {
      await addShipmentLine(docId, {
        product_id:        item.product_id,
        product_name:      item.product_name,
        product_sku:       item.product_sku,
        color_id:          item.color_id,
        color_name:        item.color_name,
        size_id:           item.size_id,
        size_name:         item.size_name,
        qty,
        storage_zone_id:   zoneId,
        storage_zone_name: zoneName,
      })
      await refreshAfterLineChange()
      setShowPicker(false)
    })
  }

  async function handleSaveQty(line: ShipmentLine) {
    if (!docId) return
    const draft = getDraft(line)
    setSaving((prev) => ({ ...prev, [line.id]: true }))
    try {
      await updateShipmentLine(docId, line.id, {
        product_id:        line.product_id,
        product_name:      line.product_name,
        product_sku:       line.product_sku,
        color_id:          line.color_id,
        color_name:        line.color_name,
        size_id:           line.size_id,
        size_name:         line.size_name,
        qty:               draft.qty,
        shipped_qty:       draft.shippedQty,
        storage_zone_id:   draft.zoneId || null,
        storage_zone_name: draft.zoneName,
      })
      await refreshAfterLineChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving((prev) => ({ ...prev, [line.id]: false }))
    }
  }

  async function handleSaveAllLines() {
    if (!docId) return
    const changed = editableLines.filter((line) => {
      const d = getDraft(line)
      return d.qty !== line.qty || d.shippedQty !== line.shipped_qty
        || d.zoneId !== (line.storage_zone_id ?? '') || d.zoneName !== (line.storage_zone_name ?? null)
    })
    for (const line of changed) {
      await handleSaveQty(line)
    }
  }

  async function handleSaveChanges() {
    if (infoDirty) {
      const saved = await handleInfoSave()
      if (!saved) return
    }
    if (hasUnsavedLineChanges) await handleSaveAllLines()
  }

  async function handleDeleteLine(lineId: string) {
    if (!docId) return
    const ok = await confirm({
      title: 'Удалить товар из отгрузки?',
      body: 'Строка будет удалена из состава отгрузки. Это действие можно отменить только добавив товар заново.',
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    await act(async () => {
      await deleteShipmentLine(docId, lineId)
      await refreshAfterLineChange()
    })
  }

  function handleAdvanceClick() {
    if (advanceBlockReasons.length > 0) {
      setShowBlockReasons(true)
      return
    }
    setShowBlockReasons(false)
    void act(async () => {
      if (infoDirty) {
        const saved = await handleInfoSave()
        if (!saved) return
      }
      if (hasUnsavedLineChanges) await handleSaveAllLines()
      const res = await advanceShipment(docId!)
      const nextStatus = res.message as ShipmentStatus
      setDoc((prev) => prev
        ? {
            ...prev,
            status: nextStatus,
            status_label: SHIPMENT_STATUS_LABELS[nextStatus],
          }
        : prev)
    })
  }

  async function handleCancel() {
    const ok = await confirm({
      title: 'Аннулировать отгрузку?',
      body: 'Отгрузка будет аннулирована. Это действие нельзя отменить.',
      danger: true,
      confirmLabel: 'Аннулировать',
    })
    if (!ok) return
    await act(() => cancelShipment(docId!), '/inventory/shipments')
  }

  if (loading) {
    return (
      <div className="page">
        <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div>
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="page">
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--c-danger)' }}>
          {error || 'Документ не найден'}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="detail-status-row">
            <button className="btn ghost icon sm" onClick={() => navigate('/inventory/shipments')}>
              <Icon name="arrowLeft" size={14} />
            </button>
            <Badge tone={SHIPMENT_STATUS_TONES[status!] as BadgeTone} dot>
              {SHIPMENT_STATUS_LABELS[status!]}
            </Badge>
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
              {doc.ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({doc.ops.length})</span>}
            </button>
            {status === 'draft' && (
              <button className="btn ghost" disabled={acting} onClick={() => act(() => deleteShipment(docId!), '/inventory/shipments')}>
                <Icon name="trash" size={14} />Удалить
              </button>
            )}
            {status === 'draft' && (
              <button className="btn primary" disabled={acting} onClick={handleAdvanceClick}>
                <Icon name="arrowRight" size={14} />Запланировать
              </button>
            )}
            {isPlanned && (
              <button className="btn ghost danger" disabled={acting} onClick={handleCancel}>
                <Icon name="x" size={14} />Аннулировать
              </button>
            )}
            {canEditPlan && (infoDirty || hasUnsavedLineChanges) && (
              <button className="btn" disabled={acting || infoSaving} onClick={() => { void handleSaveChanges() }}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
            {isPlanned && (
              <button className="btn primary" disabled={acting} onClick={handleAdvanceClick}>
                <Icon name="arrowRight" size={14} />Отгрузить
              </button>
            )}
          </div>
          {showBlockReasons && advanceBlockReasons.length > 0 && (
            <div className="block-reasons">
              {advanceBlockReasons.map((reason, index) => (
                <div key={index}>— {reason}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ShipmentStepper status={status!} ops={doc.ops} style={{ marginTop: -10 }} />

      {error && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{error}</Alert>
      )}

      <div className="split-360">
        <div className="col gap-16">
          <div className="card">
            <div className="card-head">
              <Icon name="file" size={15} className="ic-accent" />
              <div className="card-head-title">Основная информация</div>
              {canEditInfo && infoSaved && (
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Icon name="check" size={12} />Сохранено
                </span>
              )}
            </div>
            {canEditInfo ? (
              <div className="card-body">
                <CargoTypeDisplay value={doc.cargo_type as ShipmentCargoType} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
                  <Field label="Клиент" style={{ marginBottom: 0 }}>
                    <div style={{ position: 'relative' }}>
                      <Input
                        value={doc.client_name ?? '—'}
                        readOnly
                        style={{ paddingRight: 34, cursor: 'default' }}
                      />
                      <div style={{
                        position: 'absolute',
                        right: 9,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--c-text-subtle)',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}>
                        <Tooltip content="Клиент нельзя изменить после добавления товаров">
                          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                            <Icon name="lock" size={13} />
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                  </Field>
                  <Field label="Дата отгрузки" required style={{ marginBottom: 0 }}>
                    <DatePicker value={infoShipDate} onChange={(v) => { setInfoShipDate(v); setInfoDirty(true) }} />
                  </Field>
                  {showCosts && (
                    <Field label="Стоимость логистики, ₽" required style={{ marginBottom: 0 }}>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step={0.01}
                        value={infoLogisticsCost}
                        onChange={(e) => { setInfoLogisticsCost(e.target.value); setInfoDirty(true) }}
                        placeholder="0.00"
                      />
                    </Field>
                  )}
                  <Field label="Комментарий" style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                    <textarea
                      className="input"
                      rows={3}
                      placeholder="Примечание для команды склада"
                      value={infoComment}
                      onChange={(e) => { setInfoComment(e.target.value); setInfoDirty(true) }}
                      style={{ resize: 'vertical', minHeight: 76 }}
                    />
                  </Field>
                </div>
              </div>
            ) : (
              <div style={{ padding: '12px 16px' }}>
                <CargoTypeDisplay value={doc.cargo_type as ShipmentCargoType} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
                  <ReadOnlyField label="Клиент" value={doc.client_name} />
                  <ReadOnlyField label="Дата отгрузки" value={fmtDateLong(doc.ship_date)} />
                  {showCosts && (
                    <ReadOnlyField
                      label="Стоимость логистики, ₽"
                      value={doc.logistics_cost != null ? doc.logistics_cost.toLocaleString('ru-RU') : null}
                      mono
                    />
                  )}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <ReadOnlyField label="Комментарий" value={doc.comment} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="boxes" size={15} className="ic-accent" />
              <div className="card-head-title">Состав отгрузки</div>
              {doc.lines.length > 0 && (
                <span className="badge accent" style={{ marginLeft: 6 }}>{doc.lines.length}</span>
              )}
              {canDelete && (
                <div className="right">
                  <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={acting || !doc.client_id}>
                    <Icon name="plus" size={12} />Добавить товар
                  </button>
                </div>
              )}
            </div>
            {doc.lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState
                  title="Состав пуст"
                  sub={canDelete ? 'Добавьте товар из остатков, чтобы запланировать отгрузку' : 'Нет позиций'}
                />
              </div>
            ) : (
              <ShipmentLinesTable
                lines={editableLines}
                cargoType={doc.cargo_type as ShipmentCargoType}
                canEditPlan={canEditPlan}
                canEditShipped={canEditShipped}
                canDelete={canDelete}
                acting={acting}
                saving={saving}
                getDraft={getDraft}
                getAvailable={getDraftAvailable}
                getZoneOptions={getLineZoneOptions}
                onQty={setDraftQty}
                onShippedQty={setDraftShippedQty}
                onZone={setDraftZone}
                onDelete={handleDeleteLine}
              />
            )}
          </div>

        </div>

        <div className="col gap-16">
          {showReadiness && (
            <div className="card">
              <div className="card-head">
                <Icon name="check" size={15} className="ic-success" />
                <div className="card-head-title">Готовность</div>
                <span
                  className="right"
                  style={{
                    fontSize: 12,
                    color: readinessOk ? 'var(--c-success)' : 'var(--c-warning)',
                    fontWeight: 600,
                  }}
                >
                  {readinessOk ? 'Готово' : 'Не готово'}
                </span>
              </div>
              <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--c-border)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
                  <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>Отгружено, ед.</span>
                  <span style={{ fontSize: 13 }}>
                    <b className="mono">{shippedUnits}</b>
                    <span style={{ color: 'var(--c-text-subtle)' }}> / {plannedUnits}</span>
                    <span
                      style={{
                        marginLeft: 8,
                        fontWeight: 600,
                        color: shippedPct >= 100 ? 'var(--c-success)' : 'var(--c-info, #3b82f6)',
                      }}
                    >
                      {shippedPct}%
                    </span>
                  </span>
                </div>
                <div className="prog">
                  <div className="prog-fill" style={{ width: `${Math.min(100, shippedPct)}%` }} />
                </div>
              </div>
              <div className="readiness-list">
                {advanceChecks.map((check, index) => (
                  <div key={index} className="readiness-row">
                    {check.ok ? (
                      <div className="readiness-dot ok">
                        <Icon name="check" size={10} />
                      </div>
                    ) : (
                      <div className="readiness-dot pending" />
                    )}
                    <span className={`readiness-label ${check.ok ? 'ok' : 'pending'}`}>{check.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <Icon name="chart" size={15} className="ic-accent" />
              <div className="card-head-title">Итого</div>
            </div>
            <div className="totals-grid">
              <span className="key">SKU</span>
              <span className="val mono">{doc.sku_count}</span>
              <span className="key">Кол-во</span>
              <span className="val mono" style={{ fontWeight: 500, fontSize: 14 }}>{doc.total_qty}</span>
            </div>
          </div>
        </div>
      </div>

      <Drawer
        open={opsDrawerOpen}
        onClose={() => setOpsDrawerOpen(false)}
        title="Журнал операций"
        subtitle={`${doc.ops.length} записей · ${doc.doc_number}`}
        width={460}
        footer={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--c-text-subtle)' }}>
            <Icon name="shield" size={11} />
            <span>Операции не редактируются. Удаление запрещено.</span>
          </div>
        }
      >
        {doc.ops.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
            Нет операций
          </div>
        ) : (
          <div className="ops-timeline">
            {doc.ops.map((op) => (
              <OpEntry key={op.id} op={op} />
            ))}
          </div>
        )}
      </Drawer>

      {showPicker && (
        <BalancePicker
          clientId={doc.client_id}
          cargoType={doc.cargo_type as ShipmentCargoType}
          onAdd={(item, qty, zoneId, zoneName) => { void handleAddLine(item, qty, zoneId, zoneName) }}
          onClose={() => setShowPicker(false)}
        />
      )}

    </div>
  )
}

function ReadOnlyField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="field-label"><span>{label}</span></div>
      <div style={{ fontSize: 13, fontWeight: 500, minHeight: 30, display: 'flex', alignItems: 'center' }}>
        <span className={mono ? 'mono' : undefined}>{value || '—'}</span>
      </div>
    </div>
  )
}

// --- ShipmentLinesTable ---

const groupBorder = '1px solid var(--c-border)'
const tintShipped = 'var(--c-bg-sunken)'

type ShipmentLinesTableProps = {
  lines:          EditableShipmentLine[]
  cargoType:      ShipmentCargoType
  canEditPlan:    boolean
  canEditShipped: boolean
  canDelete:      boolean
  acting:         boolean
  saving:         Record<string, boolean>
  getDraft:       (line: ShipmentLine) => LineDraft
  getAvailable:   (line: ShipmentLine) => number
  getZoneOptions: (line: ShipmentLine) => ZoneChoice[]
  onQty:          (lineId: string, v: number) => void
  onShippedQty:   (lineId: string, v: number) => void
  onZone:         (lineId: string, zoneId: string, zoneName: string | null) => void
  onDelete:       (lineId: string) => void
}

function ShipmentLinesTable({
  lines, cargoType, canEditPlan, canEditShipped, canDelete,
  acting, saving, getDraft, getAvailable, getZoneOptions, onQty, onShippedQty, onZone, onDelete,
}: ShipmentLinesTableProps) {
  const skuCount = new Set(lines.map((l) => l.product_sku)).size
  const planTotal = lines.reduce((s, l) => s + getDraft(l).qty, 0)
  const shippedTotal = lines.reduce((s, l) => s + getDraft(l).shippedQty, 0)
  const showZone = cargoType === 'good' || cargoType === 'defect'
  // cols: Товар | План | [Отгружено Кол-во | Отгружено Из места] | Действие
  const colCount = 2 + (showZone ? 2 : 1) + (canDelete ? 1 : 0)

  return (
    <Table>
      <thead>
        <tr>
          <th rowSpan={2}>Товар</th>
          <th rowSpan={2} style={{ width: 110, textAlign: 'right' }}>План</th>
          <th
            colSpan={showZone ? 2 : 1}
            style={{ background: tintShipped, textAlign: 'center', borderLeft: groupBorder }}
          >
            Отгружено
          </th>
          {canDelete && <th rowSpan={2} style={{ width: 44 }}>Действия</th>}
        </tr>
        <tr>
          <th style={{ width: 110, textAlign: 'right', background: tintShipped, borderLeft: groupBorder }}>
            Кол-во
          </th>
          {showZone && (
            <th style={{ width: 112, background: tintShipped }}>Из места</th>
          )}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const draft = getDraft(line)
          const available = getAvailable(line)
          const visibleAvailable = canEditShipped ? available : line.available
          const zoneOptions = getZoneOptions(line)
          const overAvailable = canEditShipped && draft.shippedQty > available
          const isSaving = saving[line.id] ?? false

          return (
            <tr key={line.id}>
              <Td>
                <LineIdentityCell
                  name={line.product_name}
                  sku={line.product_sku}
                  color={line.color_name}
                  size={line.size_name}
                />
                {canEditPlan && (
                  <div className="t-sub" style={{ marginTop: 2, color: overAvailable ? 'var(--c-warning)' : 'var(--c-success)' }}>
                    доступно {visibleAvailable}
                  </div>
                )}
              </Td>
              <Td className="num">
                {canEditPlan ? (
                  <NumberStep
                    value={draft.qty}
                    onChange={(v) => onQty(line.id, v)}
                    disabled={acting || isSaving}
                    width={100}
                  />
                ) : (
                  <span className="mono" style={{ fontWeight: 500 }}>{line.qty}</span>
                )}
              </Td>
              <Td className="num" style={{ background: tintShipped, borderLeft: groupBorder }}>
                {canEditPlan ? (
                  <NumberStep
                    value={draft.shippedQty}
                    onChange={(v) => onShippedQty(line.id, v)}
                    min={0}
                    warning={overAvailable}
                    disabled={acting || isSaving || !canEditShipped}
                    width={100}
                  />
                ) : (
                  <span className="mono" style={{ fontWeight: 500 }}>{line.shipped_qty}</span>
                )}
              </Td>
              {showZone && (
                <Td style={{ background: tintShipped }}>
                  <ZoneCell
                    value={draft.zoneId}
                    zones={zoneOptions}
                    onChange={(zoneId) => {
                      const z = zoneOptions.find((z) => z.id === zoneId)
                      onZone(line.id, zoneId, z?.name ?? null)
                    }}
                    disabled={acting || isSaving || !canEditShipped}
                    emptyHint="Нет доступных мест хранения для этого товара"
                    readonly={!canEditPlan}
                    readonlyLabel={line.storage_zone_name}
                  />
                </Td>
              )}
              {canDelete && (
                <Td>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                      className="btn ghost icon sm"
                      disabled={acting || isSaving}
                      onClick={() => onDelete(line.id)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </Td>
              )}
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={colCount} style={{ padding: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 24, padding: '10px 14px',
              background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)', fontSize: 12.5,
            }}>
              <span style={{ fontWeight: 700 }}>Итого</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>{skuCount} SKU</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>
                План <b className="mono" style={{ color: 'var(--c-text)' }}>{planTotal}</b>
              </span>
              <span style={{ color: 'var(--c-text-subtle)' }}>
                Отгружено <b className="mono" style={{ color: 'var(--c-text)' }}>{shippedTotal}</b>
              </span>
            </div>
          </td>
        </tr>
      </tfoot>
    </Table>
  )
}
