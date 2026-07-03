import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackNav } from '../../../hooks/useBackNav'
import { createDispatch, advanceDispatch, getDispatch, uploadDispatchLineFile, recommendedPallets, recommendedBoxes, getDispatchReservations, checkDispatchDuplicate } from '../../../api/dispatchApi'
import type { DispatchCargoType, DispatchLineIn } from '../../../api/dispatchApi'
import type { PlannableItem } from '../../../api/balancesApi'
import type { DuplicateMatch } from '../../../api/domainTypes'
import { DuplicateWarnModal } from './shared/DuplicateWarnModal'
import { balanceKey } from '../../../utils/balanceKey'
import { getInventoryClientStores } from '../../../api/inventoryLookupsApi'
import type { ClientStoreItem } from '../../../api/domainTypes'
import { Combobox } from '../../data/Combobox'
import type { ComboboxOption } from '../../data/Combobox'
import { Icon } from '../../primitives/Icon'
import { Field, AutoGrowTextarea } from '../../primitives/Input'
import { DatePicker } from '../../primitives/DatePicker'
import { Alert } from '../../primitives/Alert'
import { EmptyState } from '../../primitives/EmptyState'
import { BalancePicker } from './shared/BalancePicker'
import { AssignSkuDrawer } from './shared/AssignSkuDrawer'
import { NumberStep } from './shared/NumberStep'
import { AvailabilityCell } from './shared/AvailabilityCell'
import { updateProduct } from '../../../api/adminApi'
import { PhaseBlock } from '../shared/process/PhaseBlock'
import { DispHeader } from './dispatchDetail/components/DispHeader'
import { Panel, ReadRow, RailPanel, ChecklistPanel, LockedGrid } from './dispatchDetail/components/processUI'
import { PrimaryAction } from '../shared/process/PrimaryAction'
import { LineFilesCell } from './shipmentDetail/components/LineFilesCell'
import { validateDispatchFile, dispatchFileGlyph, DISPATCH_FILE_ACCEPT } from './dispatchDetail/components/DispatchLineFiles'
import { PackMultiplicity } from './dispatchDetail/components/PackMultiplicity'
import { PackPriceBanner } from './dispatchDetail/components/PackPriceBanner'
import { fmtYmdAsDmy } from '../../../utils/format'
import { canCreateDocuments, canViewCosts } from '../../../utils/access'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'

type DraftLine = DispatchLineIn & {
  _uid: string; ready: number; onHand: number; packing: number; inTransit: number; reserved: number; sku_pending: boolean
  itemsPerBox: number | null; boxes: number | null; boxesTouched: boolean
  boxesPerPallet: number | null; pallets: number | null; palletsTouched: boolean; files: File[]
}

function variantKey(productId: string, colorId: string | null | undefined, sizeId: string | null | undefined): string {
  return `${productId}|${colorId ?? ''}|${sizeId ?? ''}`
}

export function DispatchCreateFeature({ cargoType }: { cargoType: DispatchCargoType }) {
  const navigate = useNavigate()
  const goBack = useBackNav('/inventory/dispatches')

  const [clientId, setClientId] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)
  const [logisticsCost, setLogisticsCost] = useState('')
  const [shipDate, setShipDate] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [reservedMap, setReservedMap] = useState<Record<string, number>>({})
  const [clientStores, setClientStores] = useState<ClientStoreItem[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [skuLine, setSkuLine] = useState<DraftLine | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showBlockReasons, setShowBlockReasons] = useState(false)
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([])
  // Куда идти после подтверждения дубля: черновик или сразу «в ожидание рейса».
  const pendingAwaitingRef = useRef(false)
  const lineUidSeq = useRef(0)
  // Черновик, созданный при первом нажатии «В ожидание рейса»: переиспользуем его id при
  // повторном нажатии, чтобы не плодить документы, если advance упал на гейте.
  const createdIdRef = useRef<string | null>(null)

  const { clients } = useLookups()
  const { user } = useCurrentUser()
  const showCosts = canViewCosts(user)
  const canCreate = canCreateDocuments(user)

  const clientOptions: ComboboxOption[] = clients.map((c) => ({ value: c.id, label: c.name }))
  const storeOptions: ComboboxOption[] = clientStores.map((s) => ({ value: s.id, label: s.name }))

  useEffect(() => {
    if (!clientId) {
      setClientStores([])
      return
    }
    const controller = new AbortController()
    getInventoryClientStores(clientId, controller.signal)
      .then(setClientStores)
      .catch(() => setClientStores([]))
    return () => controller.abort()
  }, [clientId])

  // Резервы по вариантам — чтобы строки показывали свободный остаток (минус обещанное
  // другим незакрытым отгрузкам), совпадая с серверным гейтом «Передать на подготовку».
  useEffect(() => {
    if (!clientId) {
      setReservedMap({})
      return
    }
    const controller = new AbortController()
    getDispatchReservations({ client_id: clientId, cargo_type: cargoType }, controller.signal)
      .then((r) => {
        const map: Record<string, number> = {}
        for (const rv of r.items) map[variantKey(rv.product_id, rv.color_id, rv.size_id)] = rv.reserved
        setReservedMap(map)
      })
      .catch(() => setReservedMap({}))
    return () => controller.abort()
  }, [clientId, cargoType])

  useEffect(() => { createdIdRef.current = null }, [lines, clientId, cargoType, shipDate, logisticsCost, comment])

  const isDefectCargo = cargoType === 'defect'
  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const totalPallets = lines.reduce((s, l) => s + (l.pallets ?? 0), 0)
  const allPallets = lines.every((l) => l.pallets != null)
  const totalBoxes = lines.reduce((s, l) => s + (l.boxes ?? 0), 0)
  const allBoxes = lines.every((l) => l.boxes != null)
  // Цену подсказываем, пока единица «релевантна»: не задана (null → короб/палета ещё будут)
  // либо задана >0. Прячем только когда во всех строках явный 0. Так подсказка видна и
  // при пустых полях (частый случай — у товара нет кратности, поле не заполнено).
  const needBoxPrice = lines.some((l) => (l.boxes ?? 1) > 0)
  const needPalletPrice = lines.some((l) => (l.pallets ?? 1) > 0)
  // Источник отгрузки совпадает с бэк-гейтом: годный отгружается только из «Готов к
  // отгрузке» (ready), брак — со склада (storage_defect = onHand), минус остаток, уже
  // обещанный другим незакрытым отгрузкам (резерв). Товар на складе/в пути и зарезер-
  // вированный можно сохранить черновиком, но не передать в подготовку.
  const srcAvail = (l: DraftLine) => Math.max(0, (isDefectCargo ? l.onHand : l.ready) - l.reserved)
  const hasNotPacked = lines.some((l) => !isDefectCargo && l.qty > l.ready && l.qty <= l.ready + l.onHand)
  const hasInTransit = lines.some((l) => l.qty > l.ready + l.onHand && l.qty <= l.ready + l.onHand + l.inTransit)
  const hasOverCap = lines.some((l) => l.qty > l.ready + l.onHand + l.inTransit)
  const allReady = lines.every((l) => l.qty <= srcAvail(l))
  const logisticsCostNumber = Number(logisticsCost)
  const logisticsCostFilled = logisticsCost.trim() !== '' && Number.isFinite(logisticsCostNumber) && logisticsCostNumber >= 0

  const readyChecks = [
    { ok: !!clientId, label: 'Клиент выбран', error: 'Выберите клиента' },
    { ok: !!shipDate, label: 'Дата отгрузки (план) указана', error: 'Укажите дату отгрузки' },
    { ok: comment.trim() !== '', label: 'Техническое задание заполнено', error: 'Заполните техническое задание' },
    ...(showCosts ? [{ ok: logisticsCostFilled, label: 'Стоимость логистики указана', error: 'Укажите стоимость логистики' }] : []),
    { ok: lines.length > 0, label: 'Добавлены строки', error: 'Добавьте хотя бы одну позицию в отгрузку' },
    { ok: lines.every((l) => !l.sku_pending), label: 'У всех товаров указан SKU', error: 'Укажите SKU для товаров без артикула (кнопка «Указать SKU» в строке)' },
    { ok: !hasOverCap, label: 'Количество в пределах остатка и товара в пути', error: 'Уменьшите количество в позициях, где запрошено больше остатка и товара в пути' },
    { ok: allPallets, label: 'Указано количество палет', error: 'Укажите количество палет для каждой позиции (можно 0)' },
    { ok: allBoxes, label: 'Указано количество коробов', error: 'Укажите количество коробов для каждой позиции (можно 0)' },
    { ok: allReady, label: isDefectCargo ? 'Брак свободен на складе' : 'Товар свободен к отгрузке', error: isDefectCargo ? 'Часть брака недоступна (на складе или в резерве у других отгрузок) — уменьшите количество' : 'Часть запрошенного недоступна: товар не упакован, ещё в пути или в резерве у других отгрузок — отгрузить можно только свободный упакованный остаток, сохраните черновик' },
  ]
  const blockReasons = readyChecks.filter((check) => !check.ok).map((check) => check.error)

  function handleClientChange(val: string | number | null, opt?: ComboboxOption) {
    setClientId(val ? String(val) : null)
    setClientName(opt?.label ?? null)
    setLines([])
  }

  function updateQty(uid: string, qty: number) {
    setLines((ls) => ls.map((l) => {
      if (l._uid !== uid) return l
      const nextQty = Math.max(1, qty)
      // Пока менеджер не правил короба/палеты вручную — держим рекомендацию из кратности.
      // Цепочка: короба из штук, палеты из коробов (палета меряется в коробах).
      const boxes = l.boxesTouched ? l.boxes : (recommendedBoxes(nextQty, l.itemsPerBox) ?? l.boxes)
      const pallets = l.palletsTouched ? l.pallets : (recommendedPallets(boxes, l.boxesPerPallet) ?? l.pallets)
      return { ...l, qty: nextQty, boxes, pallets }
    }))
  }

  function setPallets(uid: string, value: number | null) {
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, pallets: value == null ? null : Math.max(0, value), palletsTouched: true }
      : l))
  }

  function setBoxes(uid: string, value: number | null) {
    setLines((ls) => ls.map((l) => {
      if (l._uid !== uid) return l
      const boxes = value == null ? null : Math.max(0, value)
      // Палеты меряются в коробах — при ручной правке коробов пересчитываем рекомендацию палет.
      const pallets = l.palletsTouched ? l.pallets : (recommendedPallets(boxes, l.boxesPerPallet) ?? l.pallets)
      return { ...l, boxes, boxesTouched: true, pallets }
    }))
  }

  function removeLine(uid: string) {
    setLines((ls) => ls.filter((l) => l._uid !== uid))
  }

  function setLineStore(uid: string, storeId: string, storeName: string | null) {
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, store_id: storeId || null, store_name: storeId ? storeName : null }
      : l))
  }

  function setLineSiteUrl(uid: string, siteUrl: string) {
    setLines((ls) => ls.map((l) => l._uid === uid ? { ...l, site_url: siteUrl } : l))
  }

  function addLineFiles(uid: string, files: File[]) {
    if (files.length === 0) return
    for (const file of files) {
      const invalid = validateDispatchFile(file)
      if (invalid) { setError(`${file.name}: ${invalid}`); return }
    }
    setError('')
    setLines((ls) => ls.map((l) => l._uid === uid ? { ...l, files: [...l.files, ...files] } : l))
  }

  function removeLineFile(uid: string, index: number) {
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, files: l.files.filter((_, i) => i !== index) }
      : l))
  }

  function replaceLineFile(uid: string, index: number, file: File) {
    const invalid = validateDispatchFile(file)
    if (invalid) { setError(`${file.name}: ${invalid}`); return }
    setError('')
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, files: l.files.map((f, i) => i === index ? file : f) }
      : l))
  }

  // Файлы стейджатся локально (у строк формы ещё нет id) и грузятся после создания:
  // матчим строку черновика к созданной по варианту + магазину + ссылке.
  async function uploadDraftFiles(docId: string) {
    const withFiles = lines.filter((l) => l.files.length > 0)
    if (withFiles.length === 0) return
    const detail = await getDispatch(docId)
    const used = new Set<string>()
    for (const draft of withFiles) {
      const target = detail.lines.find((cl) =>
        !used.has(cl.id) &&
        balanceKey(cl) === balanceKey(draft) &&
        (cl.store_id ?? null) === (draft.store_id ?? null) &&
        (cl.site_url ?? null) === (draft.site_url ?? null))
      if (!target) continue
      used.add(target.id)
      for (const file of draft.files) {
        await uploadDispatchLineFile(docId, target.id, file)
      }
    }
  }

  function makeDraftLine(b: PlannableItem, qty: number): DraftLine {
    return {
      _uid:         `line-${lineUidSeq.current++}`,
      product_id:   b.product_id,
      product_name: b.product_name,
      product_sku:  b.product_sku,
      color_id:     b.color_id,
      color_name:   b.color_name,
      size_id:      b.size_id,
      size_name:    b.size_name,
      qty,
      // «Готов к отгрузке» = разложенное ready + упакованное на столе (packed) — оба
      // можно передать в подготовку и отгрузить (совпадает с бэк-гейтом _source_ops).
      ready:        isDefectCargo ? 0 : b.ready_good + (b.packed_good ?? 0),
      onHand:       isDefectCargo ? b.storage_defect : b.storage_good,
      packing:      isDefectCargo ? 0 : (b.packing_good ?? 0),
      inTransit:    isDefectCargo ? 0 : b.in_transit,
      reserved:     reservedMap[variantKey(b.product_id, b.color_id, b.size_id)] ?? 0,
      sku_pending:  !!b.sku_pending,
      itemsPerBox:  b.items_per_box,
      boxes:        recommendedBoxes(qty, b.items_per_box),
      boxesTouched: false,
      boxesPerPallet: b.boxes_per_pallet,
      pallets:      recommendedPallets(recommendedBoxes(qty, b.items_per_box), b.boxes_per_pallet),
      palletsTouched: false,
      site_url:     null,
      store_id:     null,
      store_name:   null,
      files:        [],
    }
  }

  function addFromBalance(b: PlannableItem, qty: number) {
    setLines((ls) => [...ls, makeDraftLine(b, qty)])
  }

  function addManyFromBalance(rows: { item: PlannableItem; qty: number }[]) {
    setLines((ls) => [...ls, ...rows.map(({ item, qty }) => makeDraftLine(item, qty))])
  }

  async function handleAssignSku(line: DraftLine, skuBase: string) {
    await updateProduct(line.product_id, { sku_base: skuBase })
    setLines((ls) => ls.map((l) => l.product_id === line.product_id
      ? { ...l, sku_pending: false, product_sku: skuBase }
      : l))
  }

  async function saveLineMultiplicity(line: DraftLine, patch: { items_per_box?: number | null; boxes_per_pallet?: number | null }): Promise<boolean> {
    try {
      await updateProduct(line.product_id, patch)
      setLines((ls) => ls.map((l) => {
        if (l.product_id !== line.product_id) return l
        const itemsPerBox = patch.items_per_box !== undefined ? patch.items_per_box : l.itemsPerBox
        const boxesPerPallet = patch.boxes_per_pallet !== undefined ? patch.boxes_per_pallet : l.boxesPerPallet
        // Новая кратность освежает рекомендации по осям, которые менеджер не правил вручную.
        const boxes = l.boxesTouched ? l.boxes : (recommendedBoxes(l.qty, itemsPerBox) ?? l.boxes)
        const pallets = l.palletsTouched ? l.pallets : (recommendedPallets(boxes, boxesPerPallet) ?? l.pallets)
        return { ...l, itemsPerBox, boxesPerPallet, boxes, pallets }
      }))
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  async function handleSave(toAwaiting: boolean) {
    setError('')
    // Дубль ищем только для нового документа: если черновик уже создан, проверять нечего.
    if (!createdIdRef.current && clientId && lines.length > 0) {
      setSaving(true)
      try {
        const dup = await checkDispatchDuplicate({
          cargo_type: cargoType,
          client_id: clientId,
          ship_date: shipDate || null,
          lines: lines.map((l) => ({ product_id: l.product_id, color_id: l.color_id ?? null, size_id: l.size_id ?? null, qty: l.qty })),
        })
        if (dup.matches.length > 0) {
          pendingAwaitingRef.current = toAwaiting
          setDupMatches(dup.matches)
          setSaving(false)
          return
        }
      } catch { /* проверка на дубль не критична — не блокируем создание */ }
      setSaving(false)
    }
    await runSave(toAwaiting)
  }

  async function runSave(toAwaiting: boolean) {
    setError('')
    setSaving(true)
    try {
      // Если черновик уже создан (advance ранее упал на гейте) — переиспользуем его id,
      // чтобы повторное нажатие не плодило новые документы. Ссылка сбрасывается при правке формы.
      let docId = createdIdRef.current
      if (!docId) {
        const res = await createDispatch({
          cargo_type:  cargoType,
          client_id:   clientId || null,
          client_name: clientName || null,
          ...(showCosts ? { logistics_cost: logisticsCostFilled ? logisticsCostNumber : null } : {}),
          ship_date:   shipDate || null,
          comment:     comment.trim() || null,
          lines: lines.map((line) => ({
            product_id:   line.product_id,
            product_name: line.product_name,
            product_sku:  line.product_sku,
            color_id:     line.color_id,
            color_name:   line.color_name,
            size_id:      line.size_id,
            size_name:    line.size_name,
            qty:          line.qty,
            pallets_qty:  line.pallets,
            boxes_qty:    line.boxes,
            site_url:     line.site_url || null,
            store_id:     line.store_id ?? null,
            store_name:   line.store_name ?? null,
          })),
        })
        docId = res.message
        createdIdRef.current = docId
        await uploadDraftFiles(docId)
      }
      if (toAwaiting) await advanceDispatch(docId)
      navigate(`/inventory/dispatches/${docId}`, { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  function handleSendToAwaiting() {
    if (blockReasons.length > 0) {
      setShowBlockReasons(true)
      return
    }
    setShowBlockReasons(false)
    void handleSave(true)
  }

  if (!canCreate) {
    return (
      <div className="page">
        <div style={{ padding: 32, color: 'var(--c-text-subtle)' }}>Недостаточно прав для создания отгрузок.</div>
      </div>
    )
  }

  return (
    <div className="page">
      <DispHeader
        status="draft"
        cargoType={cargoType}
        title={isDefectCargo ? 'Новая отгрузка брака' : 'Новая отгрузка'}
        subtitle="номер присвоится при сохранении"
        onBack={goBack}
        blockReasons={showBlockReasons ? blockReasons : []}
        actions={
          <>
            <button className="btn" disabled={saving} onClick={goBack}>Отмена</button>
            <button
              className="btn"
              disabled={saving || !clientId || lines.length === 0}
              onClick={() => void handleSave(false)}
              title="Сохранить как черновик — для товара, который ещё в пути"
            >
              <Icon name="save" size={13} />Сохранить черновик
            </button>
            <PrimaryAction
              icon="arrowRight"
              label="Передать на подготовку"
              hint="уйдёт в очередь на привязку к рейсу — статус «Ожидает рейс»"
              disabled={saving}
              onClick={handleSendToAwaiting}
            />
          </>
        }
      />

      {hasOverCap && (
        <Alert tone="warning" style={{ marginBottom: 14 }}>
          <span style={{ fontWeight: 500 }}>Запрошено больше, чем остаток и товар в пути по одной или нескольким позициям.</span>
        </Alert>
      )}
      {!hasOverCap && hasInTransit && (
        <Alert tone="info" style={{ marginBottom: 14 }}>
          <span>Часть товара ещё в пути. Сохраните черновик — передать в рейс можно будет после прихода.</span>
        </Alert>
      )}
      {!hasOverCap && !hasInTransit && hasNotPacked && (
        <Alert tone="info" style={{ marginBottom: 14 }}>
          <span>Часть товара ещё не упакована. Отгрузить можно только упакованный товар — создайте задачу упаковки, а пока сохраните черновик.</span>
        </Alert>
      )}

      {error && <div style={{ color: 'var(--c-danger)', fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 332px', gap: 18, alignItems: 'start' }}>
        {/* Left — фазы */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <PhaseBlock icon="file" title="Основная информация" role="manager" state="active"
            hint="Клиент и дата отгрузки">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Клиент" required style={{ marginBottom: 0 }}>
                <Combobox
                  value={clientId}
                  onChange={handleClientChange}
                  options={clientOptions}
                  placeholder="Выберите клиента…"
                  clearable
                />
              </Field>
              <Field label="Дата отгрузки (план)" required style={{ marginBottom: 0 }}>
                <DatePicker value={shipDate} onChange={setShipDate} />
              </Field>
              {showCosts && (
                <Field label="Стоимость логистики для клиента, ₽" required style={{ marginBottom: 0 }}>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step={0.01}
                    value={logisticsCost}
                    onChange={(e) => setLogisticsCost(e.target.value)}
                  />
                </Field>
              )}
              <Field label="Техническое задание" required style={{ marginBottom: 0, gridColumn: '1 / -1' }}>
                <AutoGrowTextarea
                  minRows={3}
                  placeholder="Опишите задачу для команды склада"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  style={{ resize: 'vertical', minHeight: 76 }}
                />
              </Field>
            </div>
          </PhaseBlock>

          {showCosts && clientId && (needBoxPrice || needPalletPrice) && (
            <PackPriceBanner
              clientId={clientId}
              needBoxPrice={needBoxPrice}
              needPalletPrice={needPalletPrice}
            />
          )}

          <PhaseBlock icon="boxes" title="Состав отгрузки" role="manager" state="active"
            hint="Товар на остатках и в пути"
            right={
              <button className="btn sm primary" onClick={() => setShowPicker(true)} disabled={!clientId}>
                <Icon name="plus" size={12} />Добавить товар
              </button>
            }>

            {lines.length === 0 ? (
              <div style={{ padding: '32px 0' }}>
                <EmptyState title="Состав пуст" sub={clientId ? 'Нажмите «Добавить товар» — остатки и товар в пути' : 'Сначала выберите клиента'} />
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Товар · вариант</th>
                    <th style={{ width: 130 }}>Магазин</th>
                    <th style={{ width: 220 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--c-text-subtle)' }}>
                        <Icon name="paperclip" size={12} style={{ opacity: 0.7 }} />Ссылка и файлы
                      </span>
                    </th>
                    <th style={{ textAlign: 'right', width: 176 }}>План отгрузки</th>
                    <th style={{ textAlign: 'right', width: 150 }}>Упаковка</th>
                    <th style={{ width: 32 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const overCap = l.qty > l.ready + l.onHand + l.inTransit
                    return (
                      <tr key={l._uid} style={overCap ? { background: 'var(--c-warning-bg)' } : {}}>
                        <td>
                          <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--c-bg-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="box" size={12} style={{ color: 'var(--c-text-muted)' }} />
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{l.product_name}</div>
                          <div className="t-sub mono">{[l.product_sku, l.color_name, l.size_name].filter(Boolean).join(' · ')}</div>
                          {l.sku_pending && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <span className="badge warning">Без SKU</span>
                              <button className="btn ghost sm" onClick={() => setSkuLine(l)}>
                                <Icon name="edit" size={12} />Указать SKU
                              </button>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="store-cell-combobox">
                            <Combobox
                              value={l.store_id ?? null}
                              placeholder="Без магазина"
                              options={storeOptions}
                              onChange={(v, opt) => setLineStore(l._uid, String(v ?? ''), opt?.label ?? null)}
                              clearable
                            />
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <input
                              className="input"
                              placeholder="https://…"
                              value={l.site_url ?? ''}
                              onChange={(e) => setLineSiteUrl(l._uid, e.target.value)}
                              style={{ width: '100%' }}
                            />
                            <LineFilesCell
                              entries={l.files.map((f, i) => ({ id: String(i), filename: f.name, mimeType: f.type || null }))}
                              canEdit
                              accept={DISPATCH_FILE_ACCEPT}
                              glyphFor={dispatchFileGlyph}
                              onPreview={(entry) => {
                                const file = l.files[Number(entry.id)]
                                if (file) window.open(URL.createObjectURL(file), '_blank', 'noopener')
                              }}
                              onAdd={(files) => addLineFiles(l._uid, files)}
                              onReplace={(entryId, file) => replaceLineFile(l._uid, Number(entryId), file)}
                              onRemove={(entryId) => removeLineFile(l._uid, Number(entryId))}
                            />
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <NumberStep value={l.qty} onChange={(v) => updateQty(l._uid, v)} />
                          </div>
                          <AvailabilityCell
                            avail={{ free: srcAvail(l), ready: l.ready, reserved: l.reserved, storage: l.onHand, packing: l.packing, inTransit: l.inTransit, isDefect: isDefectCargo }}
                            plannedQty={l.qty}
                          />
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: 'var(--c-text-muted)', width: 42, textAlign: 'right' }}>Короба</span>
                              <input
                                className="input sm num"
                                inputMode="numeric"
                                placeholder="0"
                                aria-label="Количество коробов"
                                value={l.boxes != null ? String(l.boxes) : ''}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/\D/g, '')
                                  setBoxes(l._uid, raw === '' ? null : parseInt(raw, 10))
                                }}
                                style={{ width: 60, textAlign: 'right', borderColor: l.boxes == null ? 'var(--c-warning)' : undefined }}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: 'var(--c-text-muted)', width: 42, textAlign: 'right' }}>Палеты</span>
                              <input
                                className="input sm num"
                                inputMode="numeric"
                                placeholder="0"
                                aria-label="Количество палет"
                                value={l.pallets != null ? String(l.pallets) : ''}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/\D/g, '')
                                  setPallets(l._uid, raw === '' ? null : parseInt(raw, 10))
                                }}
                                style={{ width: 60, textAlign: 'right', borderColor: l.pallets == null ? 'var(--c-warning)' : undefined }}
                              />
                            </div>
                          </div>
                          <PackMultiplicity
                            productName={l.product_name}
                            itemsPerBox={l.itemsPerBox}
                            boxesPerPallet={l.boxesPerPallet}
                            qty={l.qty}
                            pallets={l.pallets}
                            boxes={l.boxes}
                            palletsTouched={l.palletsTouched}
                            boxesTouched={l.boxesTouched}
                            canEdit
                            onSaveProduct={(patch) => saveLineMultiplicity(l, patch)}
                          />
                        </td>
                        <td>
                          <button className="btn ghost icon sm" onClick={() => removeLine(l._uid)}>
                            <Icon name="trash" size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--c-bg-sunken)' }}>
                    <td colSpan={4} style={{ padding: '10px 12px', fontWeight: 500, fontSize: 12.5 }}>
                      Итого: {lines.length} SKU
                    </td>
                    <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>{totalQty}</td>
                    <td className="num" style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>{totalPallets} пал · {totalBoxes} кор</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </PhaseBlock>

          <PhaseBlock icon="truckOut" title="Рейс и отгрузка" role="manager" state="locked"
            hint="Привязка к рейсу и списание — после передачи в ожидание рейса">
            <LockedGrid labels={['Рейсы', 'Отгружено']} />
          </PhaseBlock>
        </div>

        {/* Right — маршрут + итог + готовность */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <RailPanel status="draft" />
          <Panel icon="chart" title="Итого">
            <div style={{ padding: '0 2px' }}>
              <ReadRow label="SKU" mono>{lines.length}</ReadRow>
              <ReadRow label="Кол-во" mono strong>{totalQty} шт</ReadRow>
              <ReadRow label="Коробов" mono strong>{totalBoxes}</ReadRow>
              <ReadRow label="Палет" mono strong>{totalPallets}</ReadRow>
              <ReadRow label="Дата (план)" mono>{shipDate ? fmtYmdAsDmy(shipDate) : '—'}</ReadRow>
              {showCosts && (
                <ReadRow label="Логистика" mono>{logisticsCostFilled ? `${logisticsCostNumber.toLocaleString('ru-RU')} ₽` : '—'}</ReadRow>
              )}
            </div>
          </Panel>
          <ChecklistPanel items={readyChecks.map((c) => ({ ok: c.ok, label: c.label }))} />
        </div>
      </div>

      {showPicker && (
        <BalancePicker
          clientId={clientId}
          cargoType={cargoType}
          source="dispatch"
          onAdd={(b, qty) => { addFromBalance(b, qty); setShowPicker(false) }}
          onAddMany={addManyFromBalance}
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

      <DuplicateWarnModal
        open={dupMatches.length > 0}
        matches={dupMatches}
        entityAccusative="отгрузку"
        busy={saving}
        onOpenExisting={(id) => navigate(`/inventory/dispatches/${id}`)}
        onProceed={() => { setDupMatches([]); void runSave(pendingAwaitingRef.current) }}
        onCancel={() => setDupMatches([])}
      />
    </div>
  )
}
