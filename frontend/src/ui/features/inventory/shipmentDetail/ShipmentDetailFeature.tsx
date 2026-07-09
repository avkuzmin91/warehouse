import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useBackNav } from '../../../../hooks/useBackNav'
import {
  getShipment,
  advanceShipment,
  rejectShipment,
  deleteShipment,
  cancelShipment,
  addShipmentLine,
  updateShipmentLine,
  updateShipment,
  deleteShipmentLine,
  uploadShipmentLineFile,
  deleteShipmentLineFile,
  returnShipmentLineFromPacking,
  returnShipmentToPacking,
  SHIPMENT_STATUS_LABELS,
} from '../../../../api/shipmentsApi'
import type { ShipmentDetail, ShipmentStatus, ShipmentCargoType, ShipmentLine } from '../../../../api/shipmentsApi'
import { resolvePublicUploadSrc } from '../../../../api/constants'
import { getBalances, getBalancesByZone, getPlannableItems } from '../../../../api/balancesApi'
import type { BalanceItem, BalanceZoneItem, PlannableItem } from '../../../../api/balancesApi'
import { getInventoryClientStores } from '../../../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../../../api/domainTypes'
import { ShipmentPriorityControl } from '../../inventory/ShipmentPriorityControl'
import { Icon } from '../../../primitives/Icon'
import { ShipHeader } from './components/ShipHeader'
import { PrimaryAction } from '../../shared/process/PrimaryAction'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { useToast } from '../../../feedback/Toast'
import { Drawer } from '../../../feedback/Drawer'
import { AutoGrowTextarea, Field } from '../../../primitives/Input'
import { balanceKey } from '../../../../utils/balanceKey'
import { canAcceptPackingTask, canEditShipmentFiles, canEditShipmentPlanning, canEditShipmentPriority, canEditShipments, canPackShipments } from '../../../../utils/access'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { useLookups } from '../../../../hooks/useLookups'
import { BalancePicker } from '../../inventory/shared/BalancePicker'
import { AssignSkuDrawer } from '../../inventory/shared/AssignSkuDrawer'
import { updateProduct } from '../../../../api/adminApi'
import { OpEntry } from './components/OpEntry'
import { lineAvailable } from './shared/opLabels'
import { MoveToPackingDrawer } from './components/MoveToPackingDrawer'
import type { MoveZoneOption } from './components/MoveToPackingDrawer'
import { PackingDrawer } from './components/PackingDrawer'
import { PlacePackedDrawer } from './components/PlacePackedDrawer'
import { FinishPackingConfirmModal } from './components/FinishPackingConfirmModal'
import type { LineAvailability } from '../shared/AvailabilityCell'
import { FilePreviewModal } from './components/FilePreviewModal'
import { validateLineFile } from './components/fileHelpers'
import type { InfoPhaseProps } from './components/InfoPhase'
import type { CompositionPhaseProps } from './components/CompositionPhase'
import type { PackingPhaseData } from './components/PackingPhase'
import { PlanningView } from './views/PlanningView'
import { PackingView } from './views/PackingView'
import { RelocatingView } from './views/RelocatingView'
import { FinalView } from './views/FinalView'
import type { EditableShipmentLine, LineDraft, StoreChoice, LineFilePreview } from './shared/types'

type ReadinessCheck = { ok: boolean; label: string; error: string }

export function ShipmentDetailFeature() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const goBack = useBackNav('/inventory/shipments')
  const confirm = useConfirm()
  const toast = useToast()
  const { user } = useCurrentUser()
  const { unloadingZones } = useLookups()
  const canEdit = canEditShipments(user)
  const canEditPlanning = canEditShipmentPlanning(user)
  const canEditPriority = canEditShipmentPriority(user)
  const canPack = canPackShipments(user)
  const [doc, setDoc] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [acting, setActing] = useState(false)
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [finishConfirm, setFinishConfirm] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [opsDrawerOpen, setOpsDrawerOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [skuLine, setSkuLine] = useState<ShipmentLine | null>(null)
  const [filePreview, setFilePreview] = useState<LineFilePreview | null>(null)
  const [balances, setBalances] = useState<BalanceItem[]>([])
  // Остаток «на хранении» + «в пути» под планом строки (только при правке плана).
  const [plannable, setPlannable] = useState<PlannableItem[] | null>(null)
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [uploadingLines, setUploadingLines] = useState<Record<string, boolean>>({})

  // Передача/подвоз на упаковку и внесение годного/брака (on_packing) — через шторки по строке.
  const [reviewZoneBalances, setReviewZoneBalances] = useState<BalanceZoneItem[]>([])
  const [moveDrawer, setMoveDrawer] = useState<{ line: ShipmentLine; mode: 'transfer' | 'replenish' } | null>(null)
  const [packingLine, setPackingLine] = useState<ShipmentLine | null>(null)
  const [placeLine, setPlaceLine] = useState<ShipmentLine | null>(null)
  const [savingLine, setSavingLine] = useState<string | null>(null)

  const [infoClientId, setInfoClientId] = useState<string | null>(null)
  const [infoClientName, setInfoClientName] = useState<string | null>(null)
  const [infoShipDate, setInfoShipDate] = useState('')
  const [infoActualShipDate, setInfoActualShipDate] = useState('')
  const [infoComment, setInfoComment] = useState('')
  const [infoSaving, setInfoSaving] = useState(false)
  const [infoSaved, setInfoSaved] = useState(false)
  const [infoDirty, setInfoDirty] = useState(false)

  useEffect(() => {
    if (!doc) return
    // Не затирать несохранённые правки реквизитов (ТЗ, даты) при фоновом refresh документа —
    // напр. прикрепление файла к строке перечитывает doc, но введённый текст должен остаться.
    if (infoDirty) return
    setInfoClientId(doc.client_id ?? null)
    setInfoClientName(doc.client_name ?? null)
    setInfoShipDate(doc.ship_date ?? '')
    setInfoActualShipDate(doc.actual_ship_date ?? '')
    setInfoComment(doc.comment ?? '')
    setInfoDirty(false)
  }, [doc, infoDirty])

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

  // Тихая перезагрузка: обновляет doc БЕЗ полноэкранного спиннера, чтобы не размонтировать
  // текущую вьюху. Иначе inline-сохранение (напр. прикрепление файла к строке) сбрасывало
  // несохранённые правки в других полях состава/реквизитов.
  const refresh = useCallback(async () => {
    if (!docId) return
    try {
      setDoc(await getShipment(docId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    }
  }, [docId])

  useEffect(() => { load() }, [load])

  async function handleInfoSave() {
    if (!docId) return false
    setInfoSaving(true)
    try {
      await updateShipment(docId, canEditTechTaskOnly
        ? { comment: infoComment.trim() || null }
        : {
            client_id:      infoClientId,
            client_name:    infoClientName,
            ship_date:      infoShipDate || null,
            ...(canEditActualShipDate ? { actual_ship_date: infoActualShipDate || null } : {}),
            comment:        infoComment.trim() || null,
          })
      await load()
      setInfoDirty(false)
      setInfoSaved(true)
      setTimeout(() => setInfoSaved(false), 2000)
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка сохранения', 'error')
      return false
    } finally {
      setInfoSaving(false)
    }
  }

  const status = doc?.status as ShipmentStatus | undefined
  const isDefectCargo = doc?.cargo_type === 'defect'
  const isDraft = status === 'draft'
  const isAssigned = status === 'assigned'
  const isPacking = status === 'packing'
  const isOnPacking = status === 'on_packing'
  const isRelocating = status === 'relocating'
  const isPacked = status === 'packed'
  // Легаси-статусы рейса (исторические документы) — только read-only вид.
  const isLegacyTerminal = status === 'awaiting_trip' || status === 'partially_shipped'
    || status === 'shipped' || status === 'completed_no_goods'
  // Состав и план менеджер правит до передачи на упаковку (черновик, «Ожидает принятия», «В плане»).
  const editableComposition = isDraft || isAssigned || isPacking
  const canDelete = canEditPlanning && editableComposition
  const canEditPlan = canEditPlanning && editableComposition
  const canEditInfo = canEditPlanning && editableComposition
  // Начальник склада на приёмке задачи правит ТОЛЬКО ТЗ (и файлы) — состав и реквизиты нет.
  const canEditTechTaskOnly = !canEditInfo && isAssigned && canAcceptPackingTask(user) && user?.role === 'warehouse_head'
  // Приёмка/отклонение задачи (assigned → packing / draft).
  const canAccept = isAssigned && canAcceptPackingTask(user)
  const canEditActualShipDate = false  // дата упаковки (факт) проставляется при передаче кладовщику на размещение (вход в «Перемещение»)
  const canAttachFiles = (canEditShipmentFiles(user) || canEditTechTaskOnly) && status !== 'cancelled' && !isPacked && !isLegacyTerminal
  const canMovePacking = canEdit && (isPacking || isOnPacking)
  // Возврат на хранение — откат передачи, поэтому право то же, что у передачи (Кладовщик/Менеджер).
  // У начальника смены (canPack без canEdit) кнопки возврата нет.
  const canReturnPacking = canMovePacking
  // Размещение упакованного по местам прямо на упаковке (отгрузка из упаковки до её
  // завершения) — то же право, что у раскладки: кладовщик (canEdit).
  const canPlacePacked = canEdit && isOnPacking
  // «Готово к рейсу» — кладовщик (canEdit = warehouse_manager) в статусе «Перемещение».
  const canRelocate = canEdit && isRelocating

  // Главное действие шага: метка/иконка/право зависят от статуса. «Готово к рейсу»
  // (relocating) не здесь — у него своя кнопка в панели раскладки/подготовки.
  // Брак-отгрузка минует упаковку: из черновика сразу к кладовщику на подготовку.
  const primary: { label: string; icon: 'arrowRight' | 'forklift' | 'truckOut' | 'check' | 'inbox'; hint: string; show: boolean } | null =
    isDraft && isDefectCargo
      ? { label: 'Запланировать', icon: 'arrowRight', hint: 'уйдёт кладовщику на подготовку — статус «Перемещение»', show: canEdit }
      : isDraft     ? { label: 'Поставить задачу',     icon: 'arrowRight', hint: 'уйдёт начальнику склада — статус «Ожидает принятия»', show: canEditPlanning }
      : isAssigned  ? { label: 'Принять в работу',     icon: 'inbox',      hint: 'склад берёт задачу — статус «В плане»',         show: canAccept }
      : isPacking   ? { label: 'Передать на упаковку', icon: 'forklift',   hint: 'уйдёт начальнику смены — статус «На упаковке»', show: canEdit }
      : isOnPacking ? { label: 'Завершить упаковку',    icon: 'check',      hint: 'уйдёт кладовщику — статус «Перемещение»',       show: canPack }
      : null

  const shipmentClientId = doc?.client_id ?? null
  const shipmentCargoType = doc?.cargo_type

  // Места-источники свободного годного «На хранении» нужны при передаче (packing)
  // и подвозе (on_packing); полный список остатков (BalancePicker) — только при
  // редактировании состава.
  const loadBalances = useCallback(async () => {
    if (!shipmentClientId || !(canDelete || isAssigned || canMovePacking || isOnPacking)) {
      setBalances([])
      setReviewZoneBalances([])
      setPlannable(null)
      return
    }
    // Под планом строки (правка состава) показываем «на хранении» и «в пути» —
    // plannable отдаёт in_transit, которого нет в обычном /balances.
    if (canDelete) {
      const pl = await getPlannableItems({
        client_id: shipmentClientId,
        cargo_type: shipmentCargoType === 'defect' ? 'defect' : 'good',
        limit: 500,
      })
      setPlannable(pl.items)
    } else {
      setPlannable(null)
    }
    // На приёмке задачи (assigned) начальнику склада тоже нужен остаток — чек-лист
    // «Весь товар на остатках» считается на клиенте, а править состав он не может.
    if (canDelete || isAssigned) {
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
  }, [shipmentClientId, shipmentCargoType, canDelete, isAssigned, canMovePacking, isOnPacking])

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
    try {
      await fn()
      if (redirectAfter) navigate(redirectAfter)
      else await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
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

  const plannableByKey = new Map((plannable ?? []).map((p) => [balanceKey(p), p]))
  const availLoading = canDelete && plannable === null

  // Доступность под планом строки: «на хранении» (сырьё, уже приехало) + «в пути».
  // Остальные поля LineAvailability для контекста упаковки не используются.
  function getLineAvail(line: ShipmentLine): LineAvailability {
    const p = plannableByKey.get(balanceKey(line))
    const storage = p ? (isDefectCargo ? p.storage_defect : p.storage_good) : 0
    const inTransit = p && !isDefectCargo ? p.in_transit : 0
    return { free: 0, ready: 0, reserved: 0, storage, packing: 0, inTransit, isDefect: isDefectCargo }
  }

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

  // Передача на упаковку выполняется по строке через шторку (немедленно), поэтому к моменту
  // перехода «Передать на упаковку» достаточно, что хоть что-то уже на столе (пул или упаковано).
  const someMovedToPacking = (doc?.lines ?? []).some(
    (line) => line.available_for_pack > 0 || line.packed_good + line.packed_defect > 0,
  )

  // Остаток позиции на складе (для гейта перевода черновика в план). Позиция, которой
  // ещё нет на остатках (товар в пути), в balances отсутствует → 0 → перевод блокируется.
  function lineOnHand(line: ShipmentLine): number {
    const matched = balances.find((b) => balanceKey(b) === balanceKey(line))
    if (!matched) return 0
    return isDefectCargo ? matched.storage_defect : matched.storage_good
  }
  // Перевод в план — всё-или-ничего: каждая позиция должна быть покрыта остатком на
  // складе. Бэкенд проверяет авторитетно при advance; здесь — для готовности/блокировок.
  const allLinesOnStock = (doc?.lines ?? []).every((line) => getDraft(line).qty <= lineOnHand(line))
  // Планировать отгрузку с товаром без артикула нельзя — SKU нужен для упаковки и счетов.
  const allLinesHaveSku = (doc?.lines ?? []).every((line) => !line.sku_pending)

  // Готовность нужна только на этапе сборки (черновик и «В плане» до передачи на упаковку).
  // Дальнейшие переходы (передача/упаковка/отгрузка) валидируются на бэкенде.
  // Брак-отгрузка: ТЗ не требуется, места-источники выберет кладовщик при подготовке.
  // Постановка задачи (draft) и её приёмка начальником склада (assigned) проверяют одно
  // и то же: товар на остатках, SKU, ТЗ. Бэкенд проверяет это авторитетно при advance.
  const isPlanning = isDraft || isAssigned
  const advanceChecks: ReadinessCheck[] = (isPlanning || isPacking)
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
        ...(isPlanning
          ? [{
              ok: allLinesOnStock,
              label: 'Весь товар на остатках',
              error: 'Часть товара ещё в пути — дождитесь прихода на склад и повторите',
            }]
          : []),
        ...(isPlanning
          ? [{
              ok: allLinesHaveSku,
              label: 'У всех товаров указан SKU',
              error: 'Укажите SKU для товаров без артикула (кнопка «Указать SKU» в строке)',
            }]
          : []),
        ...(isPlanning && !isDefectCargo
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
                label: 'Дата упаковки (план) указана',
                error: 'Укажите дату упаковки (план)',
              },
              {
                ok: someMovedToPacking,
                label: 'Товар передан на упаковку',
                error: 'Передайте на упаковку хотя бы часть товара (кнопка «Передать» в строке)',
              },
            ]
          : []),
      ]
    : []
  const showReadiness = isPlanning || isPacking
  const advanceBlockReasons = showReadiness
    ? advanceChecks.filter((check) => !check.ok).map((check) => check.error)
    : []
  async function refreshAfterLineChange() {
    await load()
    await loadBalances()
  }

  async function handleAddLine(item: PlannableItem, qty: number, zoneId: string | null, zoneName: string | null) {
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

  async function handleAssignSku(line: ShipmentLine, skuBase: string) {
    // SKU присваивается товару и всем вариантам; строки отгрузки хранят снимок sku,
    // поэтому после дозаполнения перечитываем документ (sku_pending берётся из products).
    await updateProduct(line.product_id, { sku_base: skuBase })
    await load()
    toast('SKU сохранён', 'success')
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
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
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
      await refresh()
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
      await refresh()
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
      await refresh()
      toast('Файл удалён', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка удаления файла', 'error')
    }
  }

  // Недобор по годному при завершении упаковки (брак в выполнение не идёт).
  const packingGoodShortfall = (doc?.lines ?? []).reduce((s, l) => s + Math.max(0, l.qty - l.packed_good), 0)

  function handleAdvanceClick() {
    if (advanceBlockReasons.length > 0) {
      setShowBlockReasons(true)
      return
    }
    setShowBlockReasons(false)
    // Завершение упаковки с недобором — напоминание упаковать весь доступный объём.
    if (isOnPacking && packingGoodShortfall > 0) {
      setFinishConfirm(true)
      return
    }
    runAdvance()
  }

  function runAdvance() {
    setFinishConfirm(false)
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

  // Менеджерский возврат «на упаковку» из «Перемещение» / «Упаковано» — для товарной
  // задачи упаковки. Из «Упаковано» откатывается раскладка по местам, поэтому подтверждаем.
  const canReturnToPacking = canEdit && !isDefectCargo && (isRelocating || isPacked)

  async function handleReturnToPacking() {
    const ok = await confirm({
      title: 'Вернуть на упаковку?',
      body: isPacked
        ? 'Задача вернётся на этап «На упаковке», а раскладка упакованного товара по местам будет отменена. Если часть товара уже отгружена, предложим вернуть только оставшийся остаток.'
        : 'Задача вернётся на этап «На упаковке» — упаковщик сможет продолжить или исправить упаковку.',
      danger: true,
      confirmLabel: 'Вернуть на упаковку',
    })
    if (!ok) return
    try {
      await returnShipmentToPacking(docId!)
      await refreshAfterLineChange()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка'
      // Часть товара уже отгружена/уехала рейсом — предлагаем частичный (force) возврат:
      // ушедшее останется вне задачи, остаток вернётся на упаковку для переразметки.
      if (!msg.includes('уже отгружена или закреплена за рейсом')) {
        toast(msg, 'error')
        return
      }
      const forceOk = await confirm({
        title: 'Вернуть остаток на упаковку?',
        body: `${msg}\n\nЧасть уже отгружена и не вернётся на стол. Вернуть только оставшийся товар — годное и брак по нему можно будет разметить заново?`,
        danger: true,
        confirmLabel: 'Вернуть остаток',
      })
      if (!forceOk) return
      await act(async () => {
        await returnShipmentToPacking(docId!, true)
        await refreshAfterLineChange()
      })
    }
  }

  async function handleReject() {
    const reason = rejectReason.trim()
    if (!reason) { toast('Укажите причину отклонения', 'error'); return }
    await act(async () => {
      await rejectShipment(docId!, reason)
      setRejectOpen(false)
      setRejectReason('')
      await load()
    })
  }

  async function handleCancel() {
    const ok = await confirm({
      title: 'Аннулировать отгрузку?',
      body: isDefectCargo && isRelocating
        ? 'Отгрузка будет аннулирована, подготовленный брак вернётся на исходные места. Это действие нельзя отменить.'
        : isOnPacking
          ? 'Задача будет аннулирована, переданный на упаковку товар вернётся на исходные места. Это действие нельзя отменить.'
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
  const compHint = isDraft ? 'Товар на остатках и в пути'
    : isPacking ? 'План можно править до передачи на упаковку'
    : undefined

  // Упаковано по документу — для гейта аннулирования «На упаковке» (пока ничего не упаковано).
  const packedGood = doc.lines.reduce((s, l) => s + l.packed_good, 0)
  const packedDefect = doc.lines.reduce((s, l) => s + l.packed_defect, 0)

  const infoProps: InfoPhaseProps = {
    doc,
    isDraft,
    isDefectCargo,
    canEditInfo,
    canEditTechTaskOnly,
    canEditActualShipDate,
    saved: infoSaved,
    shipDate: infoShipDate,
    actualShipDate: infoActualShipDate,
    comment: infoComment,
    onShipDate: (v) => { setInfoShipDate(v); setInfoDirty(true) },
    onActualShipDate: (v) => { setInfoActualShipDate(v); setInfoDirty(true) },
    onComment: (v) => { setInfoComment(v); setInfoDirty(true) },
  }

  const compositionProps: CompositionPhaseProps = {
    lines: editableLines,
    clientId: doc.client_id,
    state: compState,
    hint: compHint,
    canEditPlan,
    canDelete,
    canAttachFiles,
    acting,
    saving,
    savingLine,
    uploadingLines,
    getDraft,
    getStoreOptions: getLineStoreOptions,
    onAdd: () => setShowPicker(true),
    onPreviewFile: setFilePreview,
    onQty: setDraftQty,
    onStore: setDraftStore,
    onDelete: handleDeleteLine,
    onUploadFile: handleUploadFile,
    onReplaceFile: handleReplaceFile,
    onDeleteFile: handleDeleteFile,
    onAssignSku: setSkuLine,
    getAvail: canEditPlan ? getLineAvail : undefined,
    availLoading,
  }

  const packingProps: PackingPhaseData = {
    lines: editableLines,
    canMove: canMovePacking,
    canPack: canPack && isOnPacking,
    canReturn: canReturnPacking,
    canPlace: canPlacePacked,
    acting,
    savingLine,
    onOpenMove: (line) => setMoveDrawer({ line, mode: isOnPacking ? 'replenish' : 'transfer' }),
    onReturn: handleReturnFromPacking,
    onOpenPacking: setPackingLine,
    onOpenPlace: setPlaceLine,
  }

  const checklistItems = advanceChecks.map((c) => ({ ok: c.ok, label: c.label }))

  return (
    <div className="page">
      <ShipHeader
        status={status!}
        cargoType={doc.cargo_type as ShipmentCargoType}
        title={doc.doc_number}
        subtitle={`${isDefectCargo ? 'Задача упаковки (брак)' : 'Задача упаковки'} · ${doc.client_name ?? '—'}`}
        initiator={{ name: doc.created_by_name, createdAt: doc.created_at }}
        onBack={goBack}
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
            {canReturnToPacking && (
              <button className="btn ghost" disabled={acting} onClick={handleReturnToPacking}>
                <Icon name="arrowLeft" size={14} />Вернуть на упаковку
              </button>
            )}
            {canAccept && (
              <button className="btn ghost danger" disabled={acting} onClick={() => setRejectOpen(true)}>
                <Icon name="arrowLeft" size={14} />Отклонить
              </button>
            )}
            {(
              (canEdit && (isPacking || (isDefectCargo && isRelocating)))
              // «На упаковке» менеджер может аннулировать, только пока ничего не упаковано.
              || (canEditPlanning && isOnPacking && packedGood + packedDefect === 0)
            ) && (
              <button className="btn ghost danger" disabled={acting} onClick={handleCancel}>
                <Icon name="x" size={14} />Аннулировать
              </button>
            )}
            {(canEditPlan || canEditTechTaskOnly) && (infoDirty || hasUnsavedLineChanges) && (
              <button className="btn" disabled={acting || infoSaving} onClick={() => { void handleSaveChanges() }}>
                <Icon name="save" size={14} />Сохранить изменения
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

      {(isDraft || isAssigned) ? (
        <PlanningView
          doc={doc}
          isDraft={isDraft}
          isDefectCargo={isDefectCargo}
          info={infoProps}
          composition={compositionProps}
          packing={packingProps}
          checklist={checklistItems}
        />
      ) : (isPacking || isOnPacking) ? (
        <PackingView
          doc={doc}
          isPacking={isPacking}
          isDefectCargo={isDefectCargo}
          info={infoProps}
          composition={compositionProps}
          packing={packingProps}
          checklist={checklistItems}
        />
      ) : isRelocating ? (
        <RelocatingView
          docId={docId!}
          doc={doc}
          isDefectCargo={isDefectCargo}
          info={infoProps}
          composition={compositionProps}
          packing={packingProps}
          canRelocate={canRelocate}
          zoneOptions={unloadingZones}
          onLinesChanged={refreshAfterLineChange}
        />
      ) : (
        <FinalView
          docId={docId!}
          doc={doc}
          isPacked={isPacked}
          isLegacyTerminal={isLegacyTerminal}
          isDefectCargo={isDefectCargo}
          info={infoProps}
          composition={compositionProps}
          packing={packingProps}
          zoneOptions={unloadingZones}
          onLinesChanged={refreshAfterLineChange}
        />
      )}

      <Drawer
        open={rejectOpen}
        onClose={() => { setRejectOpen(false); setRejectReason('') }}
        title="Отклонить задачу"
        subtitle={`Возврат менеджеру · ${doc.doc_number}`}
        width={420}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost" disabled={acting} onClick={() => { setRejectOpen(false); setRejectReason('') }}>
              Отмена
            </button>
            <button className="btn primary danger" disabled={acting || !rejectReason.trim()} onClick={handleReject}>
              <Icon name="arrowLeft" size={14} />Отклонить и вернуть
            </button>
          </div>
        }
      >
        <p style={{ marginTop: 0, fontSize: 13, color: 'var(--c-text-subtle)' }}>
          Задача вернётся менеджеру в статус «Черновик». Укажите причину — она сохранится в журнале.
        </p>
        <Field label="Причина отклонения" required style={{ marginBottom: 0 }}>
          <AutoGrowTextarea
            minRows={3}
            placeholder="Например: товара нет на остатках, ошибка в составе, неверное ТЗ"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            style={{ resize: 'vertical', minHeight: 90 }}
          />
        </Field>
      </Drawer>

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

      {skuLine && (
        <AssignSkuDrawer
          productName={skuLine.product_name}
          variantLabel={[skuLine.color_name, skuLine.size_name].filter(Boolean).join(' · ') || null}
          currentSku={skuLine.sku_pending ? null : skuLine.product_sku}
          onSubmit={(skuBase) => handleAssignSku(skuLine, skuBase)}
          onClose={() => setSkuLine(null)}
        />
      )}

      <FilePreviewModal
        filename={filePreview?.file.filename ?? null}
        mimeType={filePreview?.file.mime_type ?? null}
        url={filePreview ? resolvePublicUploadSrc(filePreview.file.url) : ''}
        meta={filePreview}
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

      {placeLine && (
        <PlacePackedDrawer
          docId={docId!}
          line={placeLine}
          zoneOptions={unloadingZones}
          onClose={() => setPlaceLine(null)}
          onDone={refreshAfterLineChange}
        />
      )}

      <FinishPackingConfirmModal
        open={finishConfirm}
        docNumber={doc.doc_number}
        clientName={doc.client_name}
        lines={doc.lines}
        acting={acting}
        onCancel={() => setFinishConfirm(false)}
        onConfirm={runAdvance}
      />

    </div>
  )
}
