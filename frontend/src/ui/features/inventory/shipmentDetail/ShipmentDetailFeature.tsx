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
  returnShipmentLineFromPacking,
  SHIPMENT_STATUS_LABELS,
} from '../../../../api/shipmentsApi'
import type { ShipmentDetail, ShipmentStatus, ShipmentCargoType, ShipmentLine, ShipmentLineFile } from '../../../../api/shipmentsApi'
import { resolvePublicUploadSrc } from '../../../../api/constants'
import { getBalances, getBalancesByZone } from '../../../../api/balancesApi'
import type { BalanceItem, BalanceZoneItem } from '../../../../api/balancesApi'
import { getInventoryClientStores } from '../../../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../../../api/domainTypes'
import { ShipmentPriorityControl } from '../../inventory/ShipmentPriorityControl'
import { Icon } from '../../../primitives/Icon'
import { PhaseBlock } from '../../shared/process/PhaseBlock'
import { ShipHeader } from './components/ShipHeader'
import { Panel, ReadRow, RailPanel, ChecklistPanel, LockedGrid } from './components/processUI'
import { PrimaryAction } from '../../shared/process/PrimaryAction'
import { Alert } from '../../../primitives/Alert'
import { EmptyState } from '../../../primitives/EmptyState'
import { Tooltip } from '../../../primitives/Tooltip'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { useToast } from '../../../feedback/Toast'
import { Drawer } from '../../../feedback/Drawer'
import { Modal } from '../../../feedback/Modal'
import { DatePicker } from '../../../primitives/DatePicker'
import { AutoGrowTextarea, Field, Input } from '../../../primitives/Input'
import { fmtDateLong } from '../../../../utils/format'
import { balanceKey } from '../../../../utils/balanceKey'
import { canViewCosts, canEditShipmentFiles, canEditShipmentPlanning, canEditShipmentPriority, canEditShipments, canPackShipments } from '../../../../utils/access'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { useLookups } from '../../../../hooks/useLookups'
import { BalancePicker } from '../../inventory/shared/BalancePicker'
import { NumberStep } from '../../inventory/shared/NumberStep'
import { OpEntry } from './components/OpEntry'
import { lineAvailable } from './shared/opLabels'
import { Table, Td } from '../../../data/Table'
import { Combobox } from '../../../data/Combobox'
import type { ComboboxOption } from '../../../data/Combobox'
import { LineIdentityCell } from '../../inventory/shared/LineIdentityCell'
import { MoveToPackingDrawer } from './components/MoveToPackingDrawer'
import type { MoveZoneOption } from './components/MoveToPackingDrawer'
import { PackingDrawer } from './components/PackingDrawer'
import { RelocationPanel } from './components/RelocationPanel'
import { DefectPreparePanel } from './components/DefectPreparePanel'

type EditableShipmentLine = ShipmentLine & { _key: string; available: number }
type LineDraft = {
  qty: number
  storeId: string
  storeName: string | null
}
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

export function ShipmentDetailFeature() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const { user } = useCurrentUser()
  const { unloadingZones } = useLookups()
  const showCosts = canViewCosts(user)
  const canEdit = canEditShipments(user)
  const canEditPlanning = canEditShipmentPlanning(user)
  const canEditPriority = canEditShipmentPriority(user)
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
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [uploadingLines, setUploadingLines] = useState<Record<string, boolean>>({})

  // Передача/подвоз на упаковку и внесение годного/брака (on_packing) — через шторки по строке.
  const [reviewZoneBalances, setReviewZoneBalances] = useState<BalanceZoneItem[]>([])
  const [moveDrawer, setMoveDrawer] = useState<{ line: ShipmentLine; mode: 'transfer' | 'replenish' } | null>(null)
  const [packingLine, setPackingLine] = useState<ShipmentLine | null>(null)
  const [savingLine, setSavingLine] = useState<string | null>(null)

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
  const isDefectCargo = doc?.cargo_type === 'defect'
  const isDraft = status === 'draft'
  const isPacking = status === 'packing'
  const isOnPacking = status === 'on_packing'
  const isRelocating = status === 'relocating'
  const isAwaitingTrip = status === 'awaiting_trip'
  // Состав и план редактируются до передачи на упаковку (черновик и «В плане»).
  const editableComposition = isDraft || isPacking
  const canDelete = canEditPlanning && editableComposition
  const canEditPlan = canEditPlanning && editableComposition
  const canEditInfo = canEditPlanning && editableComposition
  const canEditActualShipDate = false  // дата отгрузки (факт) проставляется при отправке рейса
  const canAttachFiles = canEditShipmentFiles(user) && status !== 'cancelled' && status !== 'shipped'
  const canMovePacking = canEdit && (isPacking || isOnPacking)
  // Возврат на хранение — откат передачи, поэтому право то же, что у передачи (Кладовщик/Менеджер).
  // У начальника смены (canPack без canEdit) кнопки возврата нет.
  const canReturnPacking = canMovePacking
  // «Готово к рейсу» — кладовщик (canEdit = warehouse_manager) в статусе «Перемещение».
  const canRelocate = canEdit && isRelocating

  // Главное действие шага: метка/иконка/право зависят от статуса. «Готово к рейсу»
  // (relocating) не здесь — у него своя кнопка в панели раскладки/подготовки.
  // Брак-отгрузка минует упаковку: из черновика сразу к кладовщику на подготовку.
  const primary: { label: string; icon: 'arrowRight' | 'forklift' | 'truckOut' | 'check'; hint: string; show: boolean } | null =
    isDraft && isDefectCargo
      ? { label: 'Запланировать', icon: 'arrowRight', hint: 'уйдёт кладовщику на подготовку — статус «Перемещение»', show: canEdit }
      : isDraft     ? { label: 'Запланировать',       icon: 'arrowRight', hint: 'уйдёт кладовщику — статус «В плане»',          show: canEdit }
      : isPacking   ? { label: 'Передать на упаковку', icon: 'forklift',   hint: 'уйдёт начальнику смены — статус «На упаковке»', show: canEdit }
      : isOnPacking ? { label: 'Завершить упаковку',    icon: 'check',      hint: 'уйдёт кладовщику — статус «Перемещение»',       show: canPack }
      : null

  const shipmentClientId = doc?.client_id ?? null
  const shipmentCargoType = doc?.cargo_type

  // Места-источники свободного годного «На хранении» нужны при передаче (packing)
  // и подвозе (on_packing); полный список остатков (BalancePicker) — только при
  // редактировании состава.
  const loadBalances = useCallback(async () => {
    if (!shipmentClientId || !(canDelete || canMovePacking || isOnPacking)) {
      setBalances([])
      setReviewZoneBalances([])
      return
    }
    if (canDelete) {
      const res = await getBalances({
        limit: 200,
        only_positive: true,
        client_id: shipmentClientId,
        has_defect: shipmentCargoType === 'defect' ? true : undefined,
      })
      setBalances(res.items.filter((b) => shipmentCargoType === 'defect' ? b.storage_defect > 0 : b.storage_good > 0))
    } else {
      setBalances([])
    }
    const zonesRes = await getBalancesByZone({
      client_id: shipmentClientId,
      only_positive: true,
    })
    setReviewZoneBalances(zonesRes.items.filter((item) => item.op_status === 'storage' && item.quality === 'good'))
  }, [shipmentClientId, shipmentCargoType, canDelete, canMovePacking, isOnPacking])

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
      storeId:    line.store_id ?? '',
      storeName:  line.store_name ?? null,
    }
  }

  function getLineStoreOptions(line: ShipmentLine): StoreChoice[] {
    const options = clientStores.map((store) => ({ id: store.id, name: store.name }))
    if (line.store_id && !options.some((store) => store.id === line.store_id)) {
      options.unshift({ id: line.store_id, name: line.store_name ?? line.store_id })
    }
    return options
  }

  // Места-источники для передачи/подвоза — где у позиции есть свободный годный.
  function getLineSourceZoneOptions(line: ShipmentLine): MoveZoneOption[] {
    return reviewZoneBalances
      .filter((item) =>
        item.location_id
        && item.qty > 0
        && balanceKey(item) === balanceKey(line)
        && item.client_id === shipmentClientId,
      )
      .map((item) => ({
        id: item.location_id!,
        name: item.location_name ?? item.location_id!,
        available: item.qty,
      }))
  }

  async function handleReturnFromPacking(line: ShipmentLine) {
    if (!docId) return
    const ok = await confirm({
      title: 'Вернуть на хранение?',
      body: `${line.available_for_pack} шт по «${line.product_name}» вернётся в исходные местоположения. Передачу на упаковку можно будет указать заново.`,
      confirmLabel: 'Вернуть',
    })
    if (!ok) return
    setSavingLine(line.id)
    try {
      await returnShipmentLineFromPacking(docId, line.id)
      await refreshAfterLineChange()
      toast('Товар возвращён на хранение', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка возврата', 'error')
    } finally {
      setSavingLine(null)
    }
  }

  function setDraftQty(lineId: string, value: number) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], qty: Math.max(1, Number.isFinite(value) ? value : 1) },
    }))
  }

  function setDraftStore(lineId: string, storeId: string, storeName: string | null) {
    setDrafts((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], storeId, storeName },
    }))
  }

  function linePlanDirty(line: ShipmentLine): boolean {
    const d = getDraft(line)
    return d.qty !== line.qty
      || d.storeId !== (line.store_id ?? '')
      || d.storeName !== (line.store_name ?? null)
  }

  const hasUnsavedLineChanges = editableLines.some(linePlanDirty)

  const infoLogisticsNumber = Number(infoLogisticsCost)
  const infoLogisticsFilled = infoLogisticsCost.trim() !== '' && Number.isFinite(infoLogisticsNumber) && infoLogisticsNumber >= 0

  // Передача на упаковку выполняется по строке через шторку (немедленно), поэтому к моменту
  // перехода «Передать на упаковку» достаточно, что хоть что-то уже на столе (пул или упаковано).
  const someMovedToPacking = (doc?.lines ?? []).some(
    (line) => line.available_for_pack > 0 || line.packed_good + line.packed_defect > 0,
  )

  // Готовность нужна только на этапе сборки (черновик и «В плане» до передачи на упаковку).
  // Дальнейшие переходы (передача/упаковка/отгрузка) валидируются на бэкенде.
  // Брак-отгрузка: ТЗ не требуется, места-источники выберет кладовщик при подготовке.
  const advanceChecks: ReadinessCheck[] = (isDraft || isPacking)
    ? [
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
        ...(isDraft && !isDefectCargo
          ? [{
              ok: infoComment.trim() !== '',
              label: 'Техническое задание заполнено',
              error: 'Заполните техническое задание',
            }]
          : []),
        ...(isPacking
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
                ok: someMovedToPacking,
                label: 'Товар передан на упаковку',
                error: 'Передайте на упаковку хотя бы часть товара (кнопка «Передать» в строке)',
              },
            ]
          : []),
      ]
    : []
  const showReadiness = isDraft || isPacking
  const advanceBlockReasons = showReadiness
    ? advanceChecks.filter((check) => !check.ok).map((check) => check.error)
    : []
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

  async function handleSaveQty(line: ShipmentLine): Promise<boolean> {
    if (!docId) return false
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
        shipped_qty:       line.shipped_qty,
        storage_zone_id:   line.storage_zone_id ?? null,
        storage_zone_name: line.storage_zone_name,
        store_id:          draft.storeId || null,
        store_name:        draft.storeName,
      })
      await refreshAfterLineChange()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
      return false
    } finally {
      setSaving((prev) => ({ ...prev, [line.id]: false }))
    }
  }

  async function handleSaveAllLines(): Promise<boolean> {
    if (!docId) return false
    const changed = editableLines.filter(linePlanDirty)
    for (const line of changed) {
      const saved = await handleSaveQty(line)
      if (!saved) return false
    }
    return true
  }

  async function handleSaveChanges() {
    if (infoDirty) {
      const saved = await handleInfoSave()
      if (!saved) return
    }
    if (hasUnsavedLineChanges) {
      const saved = await handleSaveAllLines()
      if (!saved) return
    }
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
      if (hasUnsavedLineChanges) {
        const saved = await handleSaveAllLines()
        if (!saved) return
      }
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
      body: isDefectCargo && isAwaitingTrip
        ? 'Отгрузка будет аннулирована, подготовленный брак вернётся на исходные места. Это действие нельзя отменить.'
        : 'Отгрузка будет аннулирована. Это действие нельзя отменить.',
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

  // «Состав» — только про план (Менеджер). Подсвечиваем как активный лишь при создании;
  // в «В плане» ход у Кладовщика (блок «Передача»), поэтому Состав не подсвечиваем.
  const compState: 'active' | 'done' = isDraft ? 'active' : 'done'
  const compHint = isDraft ? 'Товар из остатков клиента'
    : isPacking ? 'План можно править до передачи на упаковку'
    : undefined

  // Фаза «Упаковка»: передача (Кладовщик, packing) → годный/брак (Нач. смены, on_packing) → результат (done).
  const packPhase = isDraft
    ? { state: 'locked' as const, role: 'shift_lead' as const, title: 'Упаковка', mode: null,
        hint: 'Передачу и упаковку заполнят кладовщик и начальник смены' }
    : isPacking
      ? { state: 'active' as const, role: 'warehouse' as const, title: 'Передача на упаковку', mode: 'transfer' as const,
          hint: '«Передать» — выбор мест-источников, перемещение сразу' }
      : isOnPacking
        ? { state: 'active' as const, role: 'shift_lead' as const, title: 'Упаковка', mode: 'packing' as const,
            hint: '«Внести упаковку» — годный и брак; при браке кладовщик подвозит товар' }
        : { state: 'done' as const, role: 'shift_lead' as const, title: 'Упаковка', mode: 'result' as const,
            hint: undefined }

  // Сводные итоги состава для панелей правой колонки.
  const planTotal = doc.lines.reduce((s, l) => s + l.qty, 0)
  const skuCount = new Set(doc.lines.map((l) => l.product_sku)).size
  const poolTotal = doc.lines.reduce((s, l) => s + l.available_for_pack, 0)
  const packedGood = doc.lines.reduce((s, l) => s + l.packed_good, 0)
  const packedDefect = doc.lines.reduce((s, l) => s + l.packed_defect, 0)
  const storeAgg = (() => {
    const m = new Map<string, number>()
    for (const l of doc.lines) {
      const k = l.store_name ?? 'Без магазина'
      m.set(k, (m.get(k) ?? 0) + l.qty)
    }
    return [...m.entries()]
  })()

  return (
    <div className="page">
      <ShipHeader
        status={status!}
        cargoType={doc.cargo_type as ShipmentCargoType}
        title={doc.doc_number}
        subtitle={`${isDefectCargo ? 'Отгрузка брака' : 'Отгрузка'} · ${doc.client_name ?? '—'}`}
        onBack={() => navigate('/inventory/shipments')}
        blockReasons={showBlockReasons ? advanceBlockReasons : []}
        priority={
          <ShipmentPriorityControl
            shipment={doc}
            canEdit={canEditPriority}
            onSaved={(priorityRank) => setDoc((prev) => prev ? { ...prev, priority_rank: priorityRank } : prev)}
          />
        }
        actions={
          <>
            <button className="btn ghost" onClick={() => setOpsDrawerOpen(true)}>
              <Icon name="layers" size={14} />Журнал
              {doc.ops.length > 0 && <span style={{ marginLeft: 4, opacity: 0.6 }}>({doc.ops.length})</span>}
            </button>
            {canEdit && isDraft && (
              <button className="btn ghost" disabled={acting} onClick={() => act(() => deleteShipment(docId!), '/inventory/shipments')}>
                <Icon name="trash" size={14} />Удалить
              </button>
            )}
            {canEdit && (isPacking || (isDefectCargo && (isRelocating || isAwaitingTrip))) && (
              <button className="btn ghost danger" disabled={acting} onClick={handleCancel}>
                <Icon name="x" size={14} />Аннулировать
              </button>
            )}
            {canEditPlan && (infoDirty || hasUnsavedLineChanges) && (
              <button className="btn" disabled={acting || infoSaving} onClick={() => { void handleSaveChanges() }}>
                <Icon name="save" size={14} />Сохранить изменения
              </button>
            )}
            {(isAwaitingTrip || status === 'shipped') && doc.trip_id && (
              <button className="btn" onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}>
                <Icon name="truckOut" size={14} />Открыть рейс {doc.trip_number}
              </button>
            )}
            {primary?.show && (
              <PrimaryAction
                icon={primary.icon}
                label={primary.label}
                hint={primary.hint}
                disabled={acting}
                onClick={handleAdvanceClick}
              />
            )}
          </>
        }
      />

      {error && (
        <Alert tone="danger" icon={false} style={{ marginBottom: 16 }}>{error}</Alert>
      )}

      {isAwaitingTrip && (
        <Alert tone="warning" style={{ marginBottom: 16 }}>
          {isDefectCargo
            ? 'Брак перемещён в зону отгрузки со статусом «Готов к отгрузке». Отгрузка ожидает отправки рейса — спишется при отправке привязанного рейса.'
            : 'Товар разложен по местоположениям со статусом «Готов к отгрузке». Отгрузка ожидает отправки рейса — спишется при отправке привязанного рейса.'}
        </Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        {/* Left — фазы */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <PhaseBlock
            icon="file"
            title="Основная информация"
            role="manager"
            state={isDraft ? 'active' : 'done'}
            hint={canEditInfo ? 'План можно править до передачи на упаковку' : undefined}
            right={canEditInfo && infoSaved ? (
              <span style={{ fontSize: 12, color: 'var(--c-success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="check" size={12} />Сохранено
              </span>
            ) : undefined}
          >
            {canEditInfo ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
                    <Field label="Дата отгрузки (факт)" style={{ marginBottom: 0 }}>
                      <Input value={fmtDateLong(doc.actual_ship_date)} readOnly style={{ cursor: 'default' }} />
                    </Field>
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
                  <Field label="Техническое задание" required={!isDefectCargo} style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                    <AutoGrowTextarea
                      minRows={3}
                      placeholder="Опишите задачу для команды склада"
                      value={infoComment}
                      onChange={(e) => { setInfoComment(e.target.value); setInfoDirty(true) }}
                      style={{ resize: 'vertical', minHeight: 76 }}
                    />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
                    <ReadOnlyField label="Техническое задание" value={doc.comment} multiline />
                  </div>
                </div>
              </>
            )}
          </PhaseBlock>

          <PhaseBlock
            icon="boxes"
            title="Состав отгрузки"
            role="manager"
            state={compState}
            hint={compHint}
            right={canDelete ? (
              <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={acting || !doc.client_id}>
                <Icon name="plus" size={12} />Добавить товар
              </button>
            ) : undefined}
          >
            {doc.lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState
                  title="Состав пуст"
                  sub={canDelete ? 'Добавьте товар из остатков, чтобы запланировать отгрузку' : 'Нет позиций'}
                />
              </div>
            ) : (
              <CompositionTable
                lines={editableLines}
                showZone={false}
                canEditPlan={canEditPlan}
                canDelete={canDelete}
                canAttachFiles={canAttachFiles}
                acting={acting}
                saving={saving}
                savingLine={savingLine}
                uploadingLines={uploadingLines}
                getDraft={getDraft}
                getStoreOptions={getLineStoreOptions}
                onPreviewFile={setFilePreview}
                onQty={setDraftQty}
                onStore={setDraftStore}
                onDelete={handleDeleteLine}
                onUploadFile={handleUploadFile}
                onReplaceFile={handleReplaceFile}
                onDeleteFile={handleDeleteFile}
              />
            )}
          </PhaseBlock>

          {!isDefectCargo && (
            <PhaseBlock
              icon="box"
              title={packPhase.title}
              role={packPhase.role}
              state={packPhase.state}
              hint={packPhase.hint}
            >
              {packPhase.mode === null ? (
                <LockedGrid labels={['На упаковке', 'Годный', 'Брак']} />
              ) : doc.lines.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                  Нет позиций для упаковки.
                </div>
              ) : (
                <PackingTable
                  mode={packPhase.mode}
                  lines={editableLines}
                  canMove={canMovePacking}
                  canPack={canPack && isOnPacking}
                  canReturn={canReturnPacking}
                  acting={acting}
                  savingLine={savingLine}
                  onOpenMove={(line) => setMoveDrawer({ line, mode: isOnPacking ? 'replenish' : 'transfer' })}
                  onReturn={handleReturnFromPacking}
                  onOpenPacking={setPackingLine}
                />
              )}
            </PhaseBlock>
          )}

          {!isDefectCargo && (isDraft || isPacking || isOnPacking) && (
            <PhaseBlock icon="archive" title="Раскладка и рейс" role="warehouse" state="locked"
              hint="Местоположения и готовность к рейсу — после упаковки">
              <LockedGrid labels={['Местоположения', 'Готово к рейсу']} />
            </PhaseBlock>
          )}

          {isDefectCargo && isDraft && (
            <PhaseBlock icon="archive" title="Подготовка к отгрузке" role="warehouse" state="locked"
              hint="Кладовщик выберет места-источники и перенесёт брак в зону отгрузки">
              <LockedGrid labels={['Места-источники', 'Готово к рейсу']} />
            </PhaseBlock>
          )}

          {isRelocating && !isDefectCargo && (
            <RelocationPanel
              docId={docId!}
              lines={doc.lines}
              zoneOptions={unloadingZones}
              canEdit={canRelocate}
              onDone={refreshAfterLineChange}
            />
          )}

          {isRelocating && isDefectCargo && (
            <DefectPreparePanel
              docId={docId!}
              lines={doc.lines}
              clientId={doc.client_id}
              canEdit={canRelocate}
              onDone={refreshAfterLineChange}
            />
          )}

          {(isAwaitingTrip || status === 'shipped') && (
            <RelocationPanel
              docId={docId!}
              lines={doc.lines}
              zoneOptions={unloadingZones}
              canEdit={false}
              readOnly
              onDone={refreshAfterLineChange}
            />
          )}
        </div>

        {/* Right — маршрут + контекстные панели */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RailPanel status={status!} ops={doc.ops} cargoType={doc.cargo_type as ShipmentCargoType} />

          {showReadiness && (
            <ChecklistPanel items={advanceChecks.map((c) => ({ ok: c.ok, label: c.label }))} />
          )}

          {(isDraft || (isDefectCargo && isRelocating)) && (
            <Panel icon="chart" title="Итого">
              <div style={{ padding: '0 2px' }}>
                <ReadRow label="SKU" mono>{skuCount}</ReadRow>
                <ReadRow label="Кол-во" mono strong>{planTotal} шт</ReadRow>
                {showCosts && (
                  <ReadRow label="Логистика" mono>{doc.logistics_cost != null ? `${doc.logistics_cost.toLocaleString('ru-RU')} ₽` : '—'}</ReadRow>
                )}
              </div>
            </Panel>
          )}

          {isPacking && storeAgg.length > 0 && (
            <Panel icon="building" title="Магазины">
              <div style={{ padding: '0 2px' }}>
                {storeAgg.map(([name, qty]) => (
                  <ReadRow key={name} label={name} mono>{qty} шт</ReadRow>
                ))}
              </div>
            </Panel>
          )}

          {isOnPacking && (
            <Panel icon="box" title="Итог упаковки">
              <div style={{ padding: '0 2px' }}>
                <ReadRow label="План" mono>{planTotal} шт</ReadRow>
                <ReadRow label="На упаковке" mono>{poolTotal} шт</ReadRow>
                <ReadRow label="Годный" mono><span style={{ color: 'var(--c-success)' }}>{packedGood}</span></ReadRow>
                <ReadRow label="Брак" mono><span style={{ color: 'var(--c-danger)' }}>{packedDefect}</span></ReadRow>
                <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                  <ReadRow label="Осталось до плана" mono strong>{Math.max(0, planTotal - packedGood)} шт</ReadRow>
                </div>
              </div>
            </Panel>
          )}

          {isRelocating && !isDefectCargo && (
            <Panel icon="chart" title="Итог раскладки">
              <div style={{ padding: '0 2px' }}>
                <ReadRow label="Годный" mono><span style={{ color: 'var(--c-success)' }}>{packedGood} шт</span></ReadRow>
                <ReadRow label="Брак" mono><span style={{ color: 'var(--c-danger)' }}>{packedDefect} шт</span></ReadRow>
                <ReadRow label="Упаковано" mono>{packedGood + packedDefect} шт</ReadRow>
              </div>
            </Panel>
          )}

          {(isAwaitingTrip || status === 'shipped') && doc.trip_id && (
            <Panel icon="truckOut" title="Рейс отгрузки">
              <button
                className="btn ghost sm"
                onClick={() => navigate(`/logistics/trips/${doc.trip_id}`)}
                style={{ width: '100%', justifyContent: 'flex-start' }}
              >
                <Icon name="truckOut" size={13} />{doc.trip_number}
              </button>
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', lineHeight: 1.5 }}>
                Дата отгрузки (факт) и списание остатков проставляются при отправке рейса.
              </div>
            </Panel>
          )}

          {status === 'shipped' && isDefectCargo && (
            <Panel icon="chart" title="Итог отгрузки">
              <div style={{ padding: '0 2px' }}>
                <ReadRow label="План" mono>{planTotal} шт</ReadRow>
                <ReadRow label="Отгружено брака" mono>
                  <span style={{ color: 'var(--c-warning)' }}>{doc.lines.reduce((s, l) => s + l.shipped_qty, 0)} шт</span>
                </ReadRow>
                {showCosts && (
                  <ReadRow label="Логистика" mono>{doc.logistics_cost != null ? `${doc.logistics_cost.toLocaleString('ru-RU')} ₽` : '—'}</ReadRow>
                )}
                <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                  <ReadRow label="Отгружено" mono strong>{fmtDateLong(doc.actual_ship_date) || '—'}</ReadRow>
                </div>
              </div>
            </Panel>
          )}

          {status === 'shipped' && !isDefectCargo && (
            <Panel icon="chart" title="Итог отгрузки">
              <div style={{ padding: '0 2px' }}>
                <ReadRow label="План" mono>{planTotal} шт</ReadRow>
                <ReadRow label="Отгружено годного" mono><span style={{ color: 'var(--c-success)' }}>{packedGood} шт</span></ReadRow>
                <ReadRow label="Брак (на складе)" mono><span style={{ color: 'var(--c-danger)' }}>{packedDefect} шт</span></ReadRow>
                {showCosts && (
                  <ReadRow label="Логистика" mono>{doc.logistics_cost != null ? `${doc.logistics_cost.toLocaleString('ru-RU')} ₽` : '—'}</ReadRow>
                )}
                <div style={{ borderTop: '1px solid var(--c-border)', marginTop: 4, paddingTop: 6 }}>
                  <ReadRow label="Отгружено" mono strong>{fmtDateLong(doc.actual_ship_date) || '—'}</ReadRow>
                </div>
              </div>
            </Panel>
          )}
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

      {moveDrawer && (
        <MoveToPackingDrawer
          docId={docId!}
          line={moveDrawer.line}
          mode={moveDrawer.mode}
          zoneOptions={getLineSourceZoneOptions(moveDrawer.line)}
          onClose={() => setMoveDrawer(null)}
          onDone={refreshAfterLineChange}
        />
      )}

      {packingLine && (
        <PackingDrawer
          docId={docId!}
          line={packingLine}
          onClose={() => setPackingLine(null)}
          onDone={refreshAfterLineChange}
        />
      )}

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

type CompositionTableProps = {
  lines:           EditableShipmentLine[]
  // Брак-отгрузка: показываем местоположение-источник строки (брак списывается с него).
  showZone?:       boolean
  canEditPlan:     boolean
  canDelete:       boolean
  canAttachFiles:  boolean
  acting:          boolean
  saving:          Record<string, boolean>
  savingLine:      string | null
  uploadingLines:  Record<string, boolean>
  getDraft:        (line: ShipmentLine) => LineDraft
  getStoreOptions: (line: ShipmentLine) => StoreChoice[]
  onPreviewFile:   (preview: LineFilePreview) => void
  onQty:           (lineId: string, v: number) => void
  onStore:         (lineId: string, storeId: string, storeName: string | null) => void
  onDelete:        (lineId: string) => void
  onUploadFile:    (lineId: string, files: File[]) => void
  onReplaceFile:   (lineId: string, oldFileId: string, file: File) => void
  onDeleteFile:    (lineId: string, fileId: string) => void
}

/** Состав отгрузки — только план: товар · магазин · план · файлы. Владелец — Менеджер. */
function CompositionTable({
  lines, showZone = false, canEditPlan, canDelete, canAttachFiles,
  acting, saving, savingLine, uploadingLines, getDraft, getStoreOptions,
  onPreviewFile, onQty, onStore, onDelete, onUploadFile, onReplaceFile, onDeleteFile,
}: CompositionTableProps) {
  const skuCount = new Set(lines.map((l) => l.product_sku)).size
  const planTotal = lines.reduce((s, l) => s + getDraft(l).qty, 0)

  return (
    <Table>
      <thead>
        <tr>
          <th style={{ width: 32 }} />
          <th>Товар · вариант</th>
          {showZone && <th style={{ width: 170 }}>Местоположение</th>}
          <th style={{ width: 180 }}>Магазин</th>
          <th style={{ width: 160, textAlign: 'right' }}>План отгрузки</th>
          <th style={{ width: 124, textAlign: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--c-text-subtle)' }}>
              <Icon name="paperclip" size={12} style={{ opacity: 0.7 }} />Файлы
            </span>
          </th>
          <th style={{ width: 44 }} />
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const draft = getDraft(line)
          const storeOptions = getStoreOptions(line)
          const isSaving = saving[line.id] ?? false
          const busy = acting || isSaving || savingLine === line.id
          const planOver = canEditPlan && draft.qty > line.available

          return (
            <tr key={line.id}>
              <Td>
                <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
                </div>
              </Td>
              <Td>
                <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} />
              </Td>
              {showZone && (
                <Td style={{ fontSize: 13 }}>
                  {line.storage_zone_name ?? <span style={{ color: 'var(--c-warning)' }}>не указано</span>}
                </Td>
              )}
              <Td>
                <StoreCell
                  value={draft.storeId}
                  stores={storeOptions}
                  onChange={(storeId) => {
                    const store = storeOptions.find((item) => item.id === storeId)
                    onStore(line.id, storeId, store?.name ?? null)
                  }}
                  disabled={busy}
                  readonly={!canEditPlan}
                  readonlyLabel={line.store_name}
                />
              </Td>
              <Td className="num">
                {canEditPlan ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                    <NumberStep value={draft.qty} onChange={(v) => onQty(line.id, v)} disabled={busy} warning={planOver} width={100} />
                    {planOver && <Icon name="alert" size={13} style={{ color: 'var(--c-warning)' }} />}
                  </div>
                ) : (
                  <span className="num" style={{ fontWeight: 500 }}>{line.qty}</span>
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
              <Td>
                {canDelete ? (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button className="btn ghost icon sm" disabled={busy} onClick={() => onDelete(line.id)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ) : null}
              </Td>
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={showZone ? 7 : 6} style={{ padding: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 24, padding: '10px 14px',
              background: 'var(--c-bg-sunken)', borderTop: '1px solid var(--c-border)', fontSize: 12.5,
            }}>
              <span style={{ fontWeight: 700 }}>Итого</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>{skuCount} SKU</span>
              <span style={{ color: 'var(--c-text-subtle)' }}>
                План <b className="num" style={{ color: 'var(--c-text)' }}>{planTotal}</b>
              </span>
            </div>
          </td>
        </tr>
      </tfoot>
    </Table>
  )
}

type PackingTableProps = {
  // transfer — передача (Кладовщик, packing); packing — годный/брак (Нач. смены, on_packing); result — итог (read-only).
  mode:          'transfer' | 'packing' | 'result'
  lines:         EditableShipmentLine[]
  canMove:       boolean
  canPack:       boolean
  canReturn:     boolean
  acting:        boolean
  savingLine:    string | null
  onOpenMove:    (line: ShipmentLine) => void
  onReturn:      (line: ShipmentLine) => void
  onOpenPacking: (line: ShipmentLine) => void
}

/** Упаковка: план-цель + на упаковке + (годный/брак) + действия передачи/упаковки. */
function PackingTable({
  mode, lines, canMove, canPack, canReturn, acting, savingLine,
  onOpenMove, onReturn, onOpenPacking,
}: PackingTableProps) {
  const planTotal = lines.reduce((s, l) => s + l.qty, 0)
  const poolTotal = lines.reduce((s, l) => s + l.available_for_pack, 0)
  const packedTotal = lines.reduce((s, l) => s + l.packed_good + l.packed_defect, 0)
  const isResult = mode === 'result'
  const showGoodDefect = mode === 'packing' || mode === 'result'
  const colCount = isResult ? 3 : showGoodDefect ? 5 : 4

  return (
    <Table>
      <thead>
        <tr>
          <th>Товар · вариант</th>
          <th style={{ width: 100, textAlign: 'right' }}>План</th>
          {!isResult && <th style={{ width: 110, textAlign: 'right' }}>На упаковке</th>}
          {showGoodDefect && <th style={{ width: 120, textAlign: 'right' }}>Годный / Брак</th>}
          {!isResult && <th style={{ width: 300 }}>{mode === 'packing' ? 'Действия упаковки' : 'Передача'}</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          const busy = acting || savingLine === line.id
          return (
            <tr key={line.id}>
              <Td>
                <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} />
              </Td>
              <Td className="num"><span className="num" style={{ fontWeight: 500 }}>{line.qty}</span></Td>
              {!isResult && (
                <Td className="num">
                  <span className="num" style={{ color: line.available_for_pack > 0 ? 'var(--c-text)' : 'var(--c-text-faint)' }}>
                    {line.available_for_pack}
                  </span>
                </Td>
              )}
              {showGoodDefect && (
                <Td className="num">
                  <span className="num" style={{ fontWeight: 600, color: 'var(--c-success)' }}>{line.packed_good}</span>
                  <span style={{ color: 'var(--c-text-faint)' }}> / </span>
                  <span className="num" style={{ fontWeight: 600, color: line.packed_defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{line.packed_defect}</span>
                </Td>
              )}
              {!isResult && (
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {mode === 'packing' && canPack && (
                      <button className="btn primary sm" disabled={busy} title="Внести годный/брак с датой упаковки" onClick={() => onOpenPacking(line)}>
                        <Icon name="check" size={12} />Внести упаковку
                      </button>
                    )}
                    {canMove && (
                      <button
                        className="btn primary sm"
                        disabled={busy}
                        title={mode === 'packing' ? 'Передать ещё товар на упаковку' : 'Передать товар в зону упаковки'}
                        onClick={() => onOpenMove(line)}
                      >
                        <Icon name="forklift" size={12} />{mode === 'packing' ? 'Передать ещё' : 'Передать'}
                      </button>
                    )}
                    {canReturn && line.available_for_pack > 0 && (
                      <button className="btn ghost sm icon" disabled={busy} title="Вернуть на хранение (откат передачи)" onClick={() => onReturn(line)}>
                        <Icon name="refresh" size={13} />
                      </button>
                    )}
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
              <span style={{ color: 'var(--c-text-subtle)' }}>
                План <b className="num" style={{ color: 'var(--c-text)' }}>{planTotal}</b>
              </span>
              {!isResult && (
                <span style={{ color: 'var(--c-text-subtle)' }}>
                  На упаковке <b className="num" style={{ color: 'var(--c-text)' }}>{poolTotal}</b>
                </span>
              )}
              {showGoodDefect && (
                <span style={{ color: 'var(--c-text-subtle)' }}>
                  Упаковано <b className="num" style={{ color: 'var(--c-text)' }}>{packedTotal}</b>
                </span>
              )}
            </div>
          </td>
        </tr>
      </tfoot>
    </Table>
  )
}
