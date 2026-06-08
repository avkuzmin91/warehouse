import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  uploadShipmentLineFile,
  deleteShipmentLineFile,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
} from '../../../api/shipmentsApi'
import type { ShipmentDetail, ShipmentStatus, ShipmentCargoType, ShipmentLine, ShipmentLineFile } from '../../../api/shipmentsApi'
import { resolvePublicUploadSrc } from '../../../api/constants'
import { getBalances, getBalancesByZone } from '../../../api/balancesApi'
import type { BalanceItem, BalanceZoneItem } from '../../../api/balancesApi'
import { getInventoryClientStores } from '../../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../../api/domainTypes'
import { ShipmentStepper } from '../../features/inventory/ShipmentStepper'
import { ShipmentPriorityControl } from '../../features/inventory/ShipmentPriorityControl'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { Alert } from '../../primitives/Alert'
import { EmptyState } from '../../primitives/EmptyState'
import { Tooltip } from '../../primitives/Tooltip'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { useToast } from '../../feedback/Toast'
import { Drawer } from '../../feedback/Drawer'
import { Modal } from '../../feedback/Modal'
import { DatePicker } from '../../primitives/DatePicker'
import { AutoGrowTextarea, Field, Input } from '../../primitives/Input'
import { fmtDateLong } from '../../../utils/format'
import { balanceKey } from '../../../utils/balanceKey'
import { canViewCosts, canEditShipmentFiles, canEditShipments, canPackShipments } from '../../../utils/access'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { BalancePicker } from '../../features/inventory/shared/BalancePicker'
import { NumberStep } from '../../features/inventory/shared/NumberStep'
import { CargoTypeDisplay } from './components/CargoTypeDisplay'
import { OpEntry } from './components/OpEntry'
import { PackingPanel } from './components/PackingPanel'
import { lineAvailable } from './shared/opLabels'
import { Table, Td } from '../../data/Table'
import { Combobox } from '../../data/Combobox'
import type { ComboboxOption } from '../../data/Combobox'
import { LineIdentityCell } from '../../features/inventory/receiptDetail/components/LineIdentityCell'
import { ZoneCell } from '../../features/inventory/receiptDetail/components/ZoneCell'

type EditableShipmentLine = ShipmentLine & { _key: string; available: number }
type LineDraft = {
  qty: number
  shippedQty: number
  zoneId: string
  zoneName: string | null
  storeId: string
  storeName: string | null
}
type ZoneChoice = { id: string; name: string; sub?: string }
type StoreChoice = { id: string; name: string }
type ReadinessCheck = { ok: boolean; label: string; error: string }
type LineFilePreview = {
  file: ShipmentLineFile
  productName: string
  sku: string
  colorName: string | null
  sizeName: string | null
  qty: number
}

export function InventoryShipmentDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canEdit = canEditShipments(user)
  const canPack = canPackShipments(user)
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [filePreview, setFilePreview] = useState<LineFilePreview | null>(null)
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [zoneBalances, setZoneBalances] = useState<BalanceZoneItem[]>([])
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [uploadingLines, setUploadingLines] = useState<Record<string, boolean>>({})

  const [infoClientId, setInfoClientId] = useState<string | null>(null)
  const [infoClientName, setInfoClientName] = useState<string | null>(null)
  const [infoShipDate, setInfoShipDate] = useState('')
  const [infoActualShipDate, setInfoActualShipDate] = useState('')
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
    setInfoActualShipDate(doc.actual_ship_date ?? '')
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
        ...(canEditActualShipDate ? { actual_ship_date: infoActualShipDate || null } : {}),
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
  const canDelete = canEdit && (isDraft || isPlanned)
  const canEditPlan = canEdit && (isDraft || isPlanned)
  const canEditShipped = canEdit && isPlanned
  const canEditInfo = canEdit && (isDraft || isPlanned)
  const canEditActualShipDate = canEdit && isPlanned
    && (user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager')
  const canAttachFiles = canEditShipmentFiles(user) && status !== 'cancelled' && status !== 'shipped'

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
    if (!shipmentClientId) {
      setClientStores([])
      return
    }
    const controller = new AbortController()
    getInventoryClientStores(shipmentClientId, controller.signal)
      .then(setClientStores)
      .catch(() => setClientStores([]))
    return () => controller.abort()
  }, [shipmentClientId])

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
          storeId:    line.store_id ?? '',
          storeName:  line.store_name ?? null,
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
      storeId:    line.store_id ?? '',
      storeName:  line.store_name ?? null,
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

  function getLineStoreOptions(line: ShipmentLine): StoreChoice[] {
    const options = clientStores.map((store) => ({ id: store.id, name: store.name }))
    if (line.store_id && !options.some((store) => store.id === line.store_id)) {
      options.unshift({ id: line.store_id, name: line.store_name ?? line.store_id })
    }
    return options
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

  function setDraftStore(lineId: string, storeId: string, storeName: string | null) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], storeId, storeName },
    }))
  }

  const hasUnsavedLineChanges = editableLines.some((line) => {
    const d = getDraft(line)
    return d.qty !== line.qty
      || d.shippedQty !== line.shipped_qty
      || d.zoneId !== (line.storage_zone_id ?? '')
      || d.zoneName !== (line.storage_zone_name ?? null)
      || d.storeId !== (line.store_id ?? '')
      || d.storeName !== (line.store_name ?? null)
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
            label: 'Дата отгрузки (план) указана',
            error: 'Укажите дату отгрузки (план)',
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
        store_id:          null,
        store_name:        null,
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
        store_id:          draft.storeId || null,
        store_name:        draft.storeName,
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
        || d.storeId !== (line.store_id ?? '') || d.storeName !== (line.store_name ?? null)
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

  async function handleUploadFile(lineId: string, files: File[]) {
    if (!docId) return
    if (files.length === 0) return
    for (const file of files) {
      const invalid = validateLineFile(file)
      if (invalid) { toast(`${file.name}: ${invalid}`, 'error'); return }
    }
    setUploadingLines((prev) => ({ ...prev, [lineId]: true }))
    try {
      for (const file of files) {
        await uploadShipmentLineFile(docId, lineId, file)
      }
      await load()
      toast(files.length === 1 ? 'Файл прикреплён' : `Файлы прикреплены: ${files.length}`, 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка загрузки файла', 'error')
    } finally {
      setUploadingLines((prev) => ({ ...prev, [lineId]: false }))
    }
  }

  async function handleReplaceFile(lineId: string, oldFileId: string, file: File) {
    if (!docId) return
    const invalid = validateLineFile(file)
    if (invalid) { toast(invalid, 'error'); return }
    setUploadingLines((prev) => ({ ...prev, [lineId]: true }))
    try {
      await uploadShipmentLineFile(docId, lineId, file)
      await deleteShipmentLineFile(docId, lineId, oldFileId)
      await load()
      toast('Файл заменён', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка замены файла', 'error')
    } finally {
      setUploadingLines((prev) => ({ ...prev, [lineId]: false }))
    }
  }

  async function handleDeleteFile(lineId: string, fileId: string) {
    if (!docId) return
    try {
      await deleteShipmentLineFile(docId, lineId, fileId)
      await load()
      toast('Файл удалён', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка удаления файла', 'error')
    }
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
            <ShipmentPriorityControl
              shipment={doc}
              canEdit={canEdit}
              onSaved={(priorityRank) => setDoc((prev) => prev ? { ...prev, priority_rank: priorityRank } : prev)}
            />
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
            {canEdit && status === 'draft' && (
              <button className="btn ghost" disabled={acting} onClick={() => act(() => deleteShipment(docId!), '/inventory/shipments')}>
                <Icon name="trash" size={14} />Удалить
              </button>
            )}
            {canEdit && status === 'draft' && (
              <button className="btn primary" disabled={acting} onClick={handleAdvanceClick}>
                <Icon name="arrowRight" size={14} />Запланировать
              </button>
            )}
            {canEdit && isPlanned && (
              <button className="btn ghost danger" disabled={acting} onClick={handleCancel}>
                <Icon name="x" size={14} />Аннулировать
              </button>
            )}
            {canEditPlan && (infoDirty || hasUnsavedLineChanges) && (
              <button className="btn" disabled={acting || infoSaving} onClick={() => { void handleSaveChanges() }}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
            {canEdit && isPlanned && (
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
                  <Field label="Рейс" style={{ marginBottom: 0 }}>
                    {doc.trip_id ? (
                      <button
                        className="btn ghost sm"
                        onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                      >
                        <Icon name="truckIn" size={13} />{doc.trip_number}
                      </button>
                    ) : (
                      <Input value="—" readOnly style={{ cursor: 'default' }} />
                    )}
                  </Field>
                  <Field label="Дата отгрузки (план)" required style={{ marginBottom: 0 }}>
                    <DatePicker value={infoShipDate} onChange={(v) => { setInfoShipDate(v); setInfoDirty(true) }} />
                  </Field>
                  {canEditActualShipDate ? (
                    <Field label="Дата отгрузки (факт)" style={{ marginBottom: 0 }}>
                      <DatePicker value={infoActualShipDate} onChange={(v) => { setInfoActualShipDate(v); setInfoDirty(true) }} />
                    </Field>
                  ) : (
                    <ReadOnlyField label="Дата отгрузки (факт)" value={fmtDateLong(doc.actual_ship_date)} />
                  )}
                  {showCosts && (
                    <Field label="Стоимость логистики для клиента, ₽" required style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
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
                    <AutoGrowTextarea
                      minRows={3}
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
                  <div>
                    <div className="field-label"><span>Рейс</span></div>
                    {doc.trip_id ? (
                      <button
                        className="btn ghost sm"
                        onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
                      >
                        <Icon name="truckIn" size={13} />{doc.trip_number}
                      </button>
                    ) : (
                      <div style={{ fontSize: 13, fontWeight: 500, minHeight: 30, display: 'flex', alignItems: 'center' }}>—</div>
                    )}
                  </div>
                  <ReadOnlyField label="Дата отгрузки (план)" value={fmtDateLong(doc.ship_date)} />
                  <ReadOnlyField label="Дата отгрузки (факт)" value={fmtDateLong(doc.actual_ship_date)} />
                  {showCosts && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <ReadOnlyField
                        label="Стоимость логистики для клиента, ₽"
                        value={doc.logistics_cost != null ? doc.logistics_cost.toLocaleString('ru-RU') : null}
                        mono
                      />
                    </div>
                  )}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <ReadOnlyField label="Комментарий" value={doc.comment} multiline />
                  </div>
                </div>
              </div>
            )}
          </div>

          {isPlanned && canPack && doc.lines.length > 0 && (
            <PackingPanel
              docId={doc.id}
              lines={doc.lines}
              disabled={acting}
              canMove={canEdit}
              canPack={canPack}
              onPreviewFile={(file, line) => setFilePreview({
                file,
                productName: line.product_name,
                sku: line.product_sku,
                colorName: line.color_name,
                sizeName: line.size_name,
                qty: line.qty,
              })}
              onReload={load}
            />
          )}

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
                canAttachFiles={canAttachFiles}
                acting={acting}
                saving={saving}
                uploadingLines={uploadingLines}
                getDraft={getDraft}
                getAvailable={getDraftAvailable}
                getZoneOptions={getLineZoneOptions}
                getStoreOptions={getLineStoreOptions}
                onPreviewFile={setFilePreview}
                onQty={setDraftQty}
                onShippedQty={setDraftShippedQty}
                onZone={setDraftZone}
                onStore={setDraftStore}
                onDelete={handleDeleteLine}
                onUploadFile={handleUploadFile}
                onReplaceFile={handleReplaceFile}
                onDeleteFile={handleDeleteFile}
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

      <ShipmentFilePreviewModal
        preview={filePreview}
        onClose={() => setFilePreview(null)}
      />

    </div>
  )
}

function ReadOnlyField({ label, value, mono, multiline }: { label: string; value: string | null | undefined; mono?: boolean; multiline?: boolean }) {
  return (
    <div>
      <div className="field-label"><span>{label}</span></div>
      <div style={{
        fontSize: 13,
        fontWeight: 500,
        minHeight: 30,
        display: 'flex',
        alignItems: multiline ? 'flex-start' : 'center',
        lineHeight: multiline ? 1.5 : undefined,
        whiteSpace: multiline ? 'pre-wrap' : undefined,
        overflowWrap: multiline ? 'anywhere' : undefined,
      }}>
        <span className={mono ? 'mono' : undefined}>{value || '—'}</span>
      </div>
    </div>
  )
}

// --- LineFilesCell ---

const ALLOWED_FILE_EXTS = ['pdf', 'png', 'jpg', 'jpeg']
const MAX_FILE_BYTES = 10 * 1024 * 1024

function validateLineFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_FILE_EXTS.includes(ext)) return 'Допустимы файлы: PDF, PNG, JPG'
  if (file.size > MAX_FILE_BYTES) return 'Файл слишком большой (максимум 10 МБ)'
  return null
}

function isPdf(mime: string | null, filename: string): boolean {
  return filename.split('.').pop()?.toLowerCase() === 'pdf' || mime === 'application/pdf'
}

function isImageFile(mime: string | null, filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return ['png', 'jpg', 'jpeg'].includes(ext) || (mime?.startsWith('image/') ?? false)
}

function fileTypeIcon(mime: string | null, filename: string): 'filePdf' | 'fileImg' {
  return isPdf(mime, filename) ? 'filePdf' : 'fileImg'
}

/** Цвет глифа: красный для PDF (как в большинстве UI), accent для картинок. */
function fileTypeColor(mime: string | null, filename: string): string {
  return isPdf(mime, filename) ? 'var(--c-danger)' : 'var(--c-accent)'
}

function shortName(name: string, max = 16): string {
  if (name.length <= max) return name
  const ext = name.includes('.') ? '.' + name.split('.').pop() : ''
  const base = name.slice(0, max - ext.length - 1)
  return `${base}…${ext}`
}

function printFile(url: string) {
  const frame = document.createElement('iframe')
  let cleaned = false
  let cleanupTimer: number | undefined

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (cleanupTimer != null) window.clearTimeout(cleanupTimer)
    window.setTimeout(() => frame.remove(), 500)
  }

  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.border = '0'
  frame.style.opacity = '0'
  frame.style.pointerEvents = 'none'
  frame.src = url
  frame.onload = () => {
    window.setTimeout(() => {
      const printWindow = frame.contentWindow
      if (!printWindow) {
        cleanup()
        return
      }

      const cleanupAfterDialog = () => {
        window.setTimeout(cleanup, 1000)
      }

      printWindow.addEventListener('afterprint', cleanupAfterDialog, { once: true })
      window.addEventListener('focus', cleanupAfterDialog, { once: true })
      cleanupTimer = window.setTimeout(cleanup, 120000)

      printWindow.focus()
      printWindow.print()
    }, 700)
  }
  document.body.appendChild(frame)
}

function fitWidthPreviewUrl(url: string): string {
  const [base] = url.split('#')
  return `${base}#zoom=page-width&view=FitH`
}

function ShipmentFilePreviewModal({ preview, onClose }: {
  preview: LineFilePreview | null
  onClose: () => void
}) {
  const file = preview?.file
  const url = file ? resolvePublicUploadSrc(file.url) : ''
  const isPdfFile = file ? isPdf(file.mime_type, file.filename) : false
  const isImage = file ? isImageFile(file.mime_type, file.filename) : false
  const previewUrl = isPdfFile ? fitWidthPreviewUrl(url) : url

  return (
    <Modal
      open={!!preview}
      onClose={onClose}
      title={file?.filename ?? 'Файл'}
      subtitle={preview ? `${preview.productName} · ${preview.sku}` : undefined}
      width={1040}
      footer={(
        <>
          <a
            className="btn ghost"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="eye" size={14} />Открыть отдельно
          </a>
          <button className="btn primary" disabled={!file} onClick={() => printFile(url)}>
            <Icon name="print" size={14} />Печать
          </button>
        </>
      )}
    >
      {preview && file && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 240px', gap: 16, minHeight: 520 }}>
          <div
            style={{
              minHeight: 520,
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--c-bg-sunken)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isPdfFile ? (
              <iframe
                title={file.filename}
                src={previewUrl}
                style={{ width: '100%', height: 520, border: 0, background: 'var(--c-bg-elev)' }}
              />
            ) : isImage ? (
              <img
                src={url}
                alt={file.filename}
                style={{
                  display: 'block',
                  width: '100%',
                  height: 520,
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div style={{ color: 'var(--c-text-subtle)', fontSize: 13 }}>Предпросмотр недоступен</div>
            )}
          </div>

          <div
            style={{
              border: '1px solid var(--c-border)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--c-bg-elev)',
              padding: 14,
              alignSelf: 'start',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--r-md)',
                  background: isPdfFile ? 'var(--c-danger-bg)' : 'var(--c-accent-bg)',
                  color: fileTypeColor(file.mime_type, file.filename),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <Icon name={fileTypeIcon(file.mime_type, file.filename)} size={17} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ШК к отгрузке
                </div>
                <div className="text-xs subtle">{isPdfFile ? 'PDF' : 'Изображение'}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <PreviewMeta label="Товар" value={preview.productName} />
              <PreviewMeta label="SKU" value={preview.sku} mono />
              <PreviewMeta label="Цвет" value={preview.colorName || '—'} />
              <PreviewMeta label="Размер" value={preview.sizeName || '—'} />
              <div
                style={{
                  marginTop: 4,
                  padding: '12px 14px',
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--c-accent-bg)',
                  border: '1px solid var(--c-accent-border)',
                }}
              >
                <div style={{ fontSize: 11.5, color: 'var(--c-accent-text)', marginBottom: 3 }}>План к печати</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-accent-text)' }}>
                  {preview.qty.toLocaleString('ru-RU')} шт
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function PreviewMeta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 2 }}>{label}</div>
      <div
        className={mono ? 'mono' : undefined}
        style={{
          fontSize: 13,
          fontWeight: 500,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function LineFilesCell({
  lineId, files, canEdit, uploading, previewMeta, onPreview, onUpload, onReplace, onDelete,
}: {
  lineId: string
  files: ShipmentLineFile[]
  canEdit: boolean
  uploading: boolean
  previewMeta: Omit<LineFilePreview, 'file'>
  onPreview: (preview: LineFilePreview) => void
  onUpload: (lineId: string, files: File[]) => void
  onReplace: (lineId: string, oldFileId: string, file: File) => void
  onDelete: (lineId: string, fileId: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<string | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  function pickFile(replaceFileId: string | null) {
    replaceTargetRef.current = replaceFileId
    inputRef.current?.click()
  }

  function previewFile(file: ShipmentLineFile) {
    onPreview({ ...previewMeta, file })
  }

  function handleInputChange(e: { target: HTMLInputElement }) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length > 0) {
      if (replaceTargetRef.current) onReplace(lineId, replaceTargetRef.current, selected[0])
      else onUpload(lineId, selected)
    }
    replaceTargetRef.current = null
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (!canEdit) return
    const dropped = Array.from(e.dataTransfer.files ?? [])
    if (dropped.length > 0) onUpload(lineId, dropped)
  }

  const updatePopPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const gap = 4
    const width = 240
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    setPopStyle({ position: 'fixed', top: rect.bottom + gap, left, width })
  }, [])

  useEffect(() => {
    if (!popoverOpen) return
    updatePopPosition()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return
      setPopoverOpen(false)
    }
    window.addEventListener('resize', updatePopPosition)
    window.addEventListener('scroll', updatePopPosition, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('resize', updatePopPosition)
      window.removeEventListener('scroll', updatePopPosition, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [popoverOpen, updatePopPosition])

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.png,.jpg,.jpeg"
      multiple
      style={{ display: 'none' }}
      onChange={handleInputChange}
    />
  )

  // Пусто + только просмотр → прочерк
  if (files.length === 0 && !canEdit) {
    return <span style={{ fontSize: 12, color: 'var(--c-text-faint)' }}>—</span>
  }

  // Пусто + можно прикрепить → приглушённая ghost-кнопка (не «кричит» на пустых строках)
  if (files.length === 0) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{ display: 'inline-flex' }}
      >
        {hiddenInput}
        <button
          type="button"
          title="Прикрепить файл (PDF, PNG, JPG)"
          disabled={uploading}
          onClick={() => pickFile(null)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            height: 28, width: 28, borderRadius: 'var(--r-md)',
            border: `1px solid ${dragOver ? 'var(--c-accent)' : 'var(--c-border)'}`,
            background: dragOver ? 'var(--c-bg-hover)' : 'var(--c-bg-elev)',
            color: 'var(--c-accent)',
            cursor: uploading ? 'default' : 'pointer', transition: 'all 120ms ease',
          }}
        >
          <Icon name={uploading ? 'refresh' : 'importFile'} size={15} />
        </button>
      </div>
    )
  }

  const single = files[0]
  const many = files.length > 1

  return (
    <div
      onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'inline-flex', justifyContent: 'center' }}
    >
      {hiddenInput}
      <div
        ref={triggerRef}
        onClick={() => { if (many) setPopoverOpen((o) => !o) }}
        title={many ? `${files.length} файла` : single.filename}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 28, maxWidth: 180, padding: '0 4px 0 8px',
          borderRadius: 'var(--r-md)',
          border: `1px solid ${dragOver ? 'var(--c-accent)' : 'var(--c-border)'}`,
          background: dragOver ? 'var(--c-bg-hover)' : 'var(--c-bg-elev)',
          cursor: many ? 'pointer' : 'default', transition: 'border-color 120ms ease',
        }}
      >
        {many ? (
          <>
            <Icon name="filePdf" size={14} style={{ color: 'var(--c-danger)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text)' }}>
              {files.length} файла
            </span>
            <Icon name="chevDown" size={12} style={{ color: 'var(--c-text-subtle)', flexShrink: 0 }} />
          </>
        ) : (
          <>
            <a
              href={resolvePublicUploadSrc(single.url)}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                previewFile(single)
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0,
                textDecoration: 'none', color: 'var(--c-text)',
              }}
            >
              <Icon
                name={fileTypeIcon(single.mime_type, single.filename)}
                size={14}
                style={{ color: fileTypeColor(single.mime_type, single.filename), flexShrink: 0 }}
              />
              <span style={{
                fontSize: 12, fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {shortName(single.filename)}
              </span>
            </a>
            {canEdit && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0,
                opacity: hover ? 1 : 0, transition: 'opacity 120ms ease',
                pointerEvents: hover ? 'auto' : 'none',
              }}>
                <button
                  type="button"
                  title="Прикрепить ещё файл"
                  disabled={uploading}
                  onClick={(e) => { e.stopPropagation(); pickFile(null) }}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-accent)' }}
                >
                  <Icon name="importFile" size={12} />
                </button>
                <button
                  type="button"
                  title="Заменить файл"
                  disabled={uploading}
                  onClick={(e) => { e.stopPropagation(); pickFile(single.id) }}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-text-subtle)' }}
                >
                  <Icon name="refresh" size={12} />
                </button>
                <button
                  type="button"
                  title="Удалить файл"
                  onClick={(e) => { e.stopPropagation(); onDelete(lineId, single.id) }}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-text-faint)' }}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            )}
          </>
        )}
      </div>

      {popoverOpen && many && createPortal(
        <div
          ref={popoverRef}
          style={{
            ...popStyle,
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-2)',
            zIndex: 9999, padding: 4,
          }}
        >
          {files.map((f) => (
            <div
              key={f.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px', borderRadius: 'var(--r-md)',
              }}
            >
              <a
                href={resolvePublicUploadSrc(f.url)}
                onClick={(e) => {
                  e.preventDefault()
                  setPopoverOpen(false)
                  previewFile(f)
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1,
                  textDecoration: 'none', color: 'var(--c-text)',
                }}
              >
                <Icon
                  name={fileTypeIcon(f.mime_type, f.filename)}
                  size={15}
                  style={{ color: fileTypeColor(f.mime_type, f.filename), flexShrink: 0 }}
                />
                <span style={{
                  fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {f.filename}
                </span>
              </a>
              {canEdit && (
                <button
                  type="button"
                  title="Удалить файл"
                  onClick={() => onDelete(lineId, f.id)}
                  className="btn ghost icon sm"
                  style={{ width: 22, height: 22, color: 'var(--c-text-faint)', flexShrink: 0 }}
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <>
              <div style={{ height: 1, background: 'var(--c-border)', margin: '4px 0' }} />
              <button
                type="button"
                disabled={uploading}
                onClick={() => { setPopoverOpen(false); pickFile(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', borderRadius: 'var(--r-md)',
                  border: 0, background: 'transparent', cursor: 'pointer',
                  fontSize: 12.5, color: 'var(--c-accent)',
                }}
              >
                <Icon name="importFile" size={15} />Прикрепить файл
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

// --- ShipmentLinesTable ---

const groupBorder = '1px solid var(--c-border)'
const tintShipped = 'var(--c-bg-sunken)'

function StoreCell({
  value,
  stores,
  onChange,
  disabled,
  readonly,
  readonlyLabel,
}: {
  value: string
  stores: StoreChoice[]
  onChange: (storeId: string) => void
  disabled?: boolean
  readonly?: boolean
  readonlyLabel?: string | null
}) {
  if (readonly) return <span className="t-sub">{readonlyLabel || '—'}</span>
  return (
    <div className="store-cell-combobox">
      <Combobox
        value={value || null}
        placeholder="Без магазина"
        options={stores.map((store): ComboboxOption => ({ value: store.id, label: store.name }))}
        onChange={(v) => onChange(String(v ?? ''))}
        disabled={disabled}
        clearable
      />
    </div>
  )
}

type ShipmentLinesTableProps = {
  lines:           EditableShipmentLine[]
  cargoType:       ShipmentCargoType
  canEditPlan:     boolean
  canEditShipped:  boolean
  canDelete:       boolean
  canAttachFiles:  boolean
  acting:          boolean
  saving:          Record<string, boolean>
  uploadingLines:  Record<string, boolean>
  getDraft:        (line: ShipmentLine) => LineDraft
  getAvailable:    (line: ShipmentLine) => number
  getZoneOptions:  (line: ShipmentLine) => ZoneChoice[]
  getStoreOptions: (line: ShipmentLine) => StoreChoice[]
  onPreviewFile:   (preview: LineFilePreview) => void
  onQty:           (lineId: string, v: number) => void
  onShippedQty:    (lineId: string, v: number) => void
  onZone:          (lineId: string, zoneId: string, zoneName: string | null) => void
  onStore:         (lineId: string, storeId: string, storeName: string | null) => void
  onDelete:        (lineId: string) => void
  onUploadFile:    (lineId: string, files: File[]) => void
  onReplaceFile:   (lineId: string, oldFileId: string, file: File) => void
  onDeleteFile:    (lineId: string, fileId: string) => void
}

function ShipmentLinesTable({
  lines, cargoType, canEditPlan, canEditShipped, canDelete, canAttachFiles,
  acting, saving, uploadingLines, getDraft, getAvailable, getZoneOptions, getStoreOptions,
  onPreviewFile, onQty, onShippedQty, onZone, onStore, onDelete, onUploadFile, onReplaceFile, onDeleteFile,
}: ShipmentLinesTableProps) {
  const skuCount = new Set(lines.map((l) => l.product_sku)).size
  const planTotal = lines.reduce((s, l) => s + getDraft(l).qty, 0)
  const shippedTotal = lines.reduce((s, l) => s + getDraft(l).shippedQty, 0)
  const packedTotal = lines.reduce((s, l) => s + l.packed_good + l.packed_defect, 0)
  const showZone = cargoType === 'good' || cargoType === 'defect'
  // cols: Товар | План | [Отгружено Кол-во | Отгружено Из места] | Файлы | Действие
  const colCount = 3 + (showZone ? 2 : 1) + 1 + (canDelete ? 1 : 0)

  return (
    <Table>
      <thead>
        <tr>
          <th rowSpan={2}>Товар</th>
          <th rowSpan={2} style={{ width: 180 }}>Магазин</th>
          <th rowSpan={2} style={{ width: 110, textAlign: 'right' }}>План</th>
          <th rowSpan={2} style={{ width: 124, textAlign: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--c-text-subtle)' }}>
              <Icon name="paperclip" size={12} style={{ opacity: 0.7 }} />Файлы
            </span>
          </th>
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
          const storeOptions = getStoreOptions(line)
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
              <Td>
                <StoreCell
                  value={draft.storeId}
                  stores={storeOptions}
                  onChange={(storeId) => {
                    const store = storeOptions.find((item) => item.id === storeId)
                    onStore(line.id, storeId, store?.name ?? null)
                  }}
                  disabled={acting || isSaving}
                  readonly={!canEditPlan}
                  readonlyLabel={line.store_name}
                />
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
              <Td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                <LineFilesCell
                  lineId={line.id}
                  files={line.files ?? []}
                  canEdit={canAttachFiles}
                  uploading={uploadingLines[line.id] ?? false}
                  previewMeta={{
                    productName: line.product_name,
                    sku: line.product_sku,
                    colorName: line.color_name,
                    sizeName: line.size_name,
                    qty: line.qty,
                  }}
                  onPreview={onPreviewFile}
                  onUpload={onUploadFile}
                  onReplace={onReplaceFile}
                  onDelete={onDeleteFile}
                />
              </Td>
              <Td className="num" style={{ background: tintShipped, borderLeft: groupBorder }}>
                {canEditPlan ? (
                  <>
                    <NumberStep
                      value={draft.shippedQty}
                      onChange={(v) => onShippedQty(line.id, v)}
                      min={0}
                      warning={overAvailable}
                      disabled={acting || isSaving || !canEditShipped}
                      width={100}
                    />
                    {canEditShipped && line.packed_good > 0 && draft.shippedQty !== line.packed_good && (
                      <button
                        className="btn ghost sm"
                        style={{ marginTop: 4, fontSize: 11, padding: '1px 6px' }}
                        disabled={acting || isSaving}
                        title="Подставить упакованное годное количество"
                        onClick={() => onShippedQty(line.id, line.packed_good)}
                      >
                        годных {line.packed_good}
                      </button>
                    )}
                  </>
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
                Упаковано <b className="mono" style={{ color: 'var(--c-text)' }}>{packedTotal}</b>
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
