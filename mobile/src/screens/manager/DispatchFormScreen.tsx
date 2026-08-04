import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  createDispatch,
  updateDispatch,
  addDispatchLine,
  updateDispatchLine,
  deleteDispatchLine,
  advanceDispatch,
  getDispatch,
  getDispatchReservations,
  recommendedPallets,
  recommendedBoxes,
  checkDispatchDuplicate,
  uploadDispatchLineFile,
  type DispatchLineIn,
  type DispatchCargoType,
  type DuplicateMatch,
} from '../../api/dispatchApi'
import { updateProductMultiplicity } from '../../api/productsApi'
import { getClients, getClientStores, type DictionaryItem, type ClientStoreItem } from '../../api/lookupsApi'
import { getPlannableItems, type PlannableItem } from '../../api/balancesApi'
import { balanceKey } from '../../utils/balanceKey'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { DateField } from '../../components/DateField'
import { TextArea } from '../../components/TextArea'
import { Icon } from '../../components/Icon'
import { BalancePickerSheet } from './BalancePickerSheet'
import { AssignSkuSheet } from './AssignSkuSheet'
import { PackMultiplicitySheet } from './PackMultiplicitySheet'
import { PackPriceBanner } from './PackPriceBanner'
import { DuplicateWarnSheet } from './DuplicateWarnSheet'

const ALLOWED_FILE_EXTS = ['zip', 'pdf', 'jpg', 'jpeg']
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** null — файл валиден; иначе текст ошибки. Совпадает с бэк-гейтом отгрузки. */
function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_FILE_EXTS.includes(ext)) return 'Допустимы zip, pdf, jpeg'
  if (file.size > MAX_FILE_BYTES) return 'Файл больше 10 МБ'
  return null
}

type DraftLine = DispatchLineIn & {
  _uid: string
  _key: string
  _serverId: string | null
  ready: number
  onHand: number
  packing: number
  inTransit: number
  sku_pending: boolean
  itemsPerBox: number | null
  boxesPerPallet: number | null
  boxes: number | null
  boxesTouched: boolean
  pallets: number | null
  palletsTouched: boolean
  files: File[]
}

function lineSub(l: DraftLine): string {
  return [l.product_sku || 'без SKU', l.color_name, l.size_name].filter(Boolean).join(' · ')
}

export function DispatchFormScreen({ docId }: { docId?: string } = {}) {
  const { back, openDispatchDoc } = useNav()
  const editing = !!docId
  const [cargoType, setCargoType] = useState<DispatchCargoType>('good')
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [clientId, setClientId] = useState('')
  const [clientName, setClientName] = useState<string | null>(null)
  const [stores, setStores] = useState<ClientStoreItem[]>([])
  const [shipDate, setShipDate] = useState('')
  const [logisticsCost, setLogisticsCost] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [reservedMap, setReservedMap] = useState<Record<string, number>>({})
  const [showPicker, setShowPicker] = useState(false)
  const [skuLine, setSkuLine] = useState<DraftLine | null>(null)
  const [multiLine, setMultiLine] = useState<DraftLine | null>(null)
  const [dupMatches, setDupMatches] = useState<DuplicateMatch[]>([])
  const [loadingDoc, setLoadingDoc] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const uidSeq = useRef(0)
  const initialServerIds = useRef<Set<string>>(new Set())
  // Куда идти после подтверждения дубля: черновик или сразу «в ожидание рейса».
  const pendingAdvanceRef = useRef(false)
  // Черновик, созданный при первом нажатии «В ожидание рейса». Если создание прошло, а
  // advance упал на гейте, повторное нажатие НЕ плодит новый документ — переиспользуем id.
  // Любая правка формы сбрасывает ссылку (см. эффект ниже), чтобы не отгрузить устаревший черновик.
  const createdIdRef = useRef<string | null>(null)

  const isDefect = cargoType === 'defect'
  const isUnpacked = cargoType === 'good_unpacked'
  // Брак и годный без упаковки минуют задачу упаковки: источник — склад (storage).
  const bypassPacking = isDefect || isUnpacked

  useEffect(() => {
    const ac = new AbortController()
    getClients(ac.signal)
      .then((res) => { if (!ac.signal.aborted) setClients(res.filter((c) => c.is_active !== false && !c.is_deleted)) })
      .catch(() => { /* aborted */ })
    return () => ac.abort()
  }, [])

  useEffect(() => {
    if (!docId) return
    const ac = new AbortController()
    setLoadingDoc(true)
    ;(async () => {
      try {
        const d = await getDispatch(docId, ac.signal)
        if (ac.signal.aborted) return
        const plannable = await getPlannableItems(
          { client_id: d.client_id || undefined, cargo_type: d.cargo_type, limit: 1000 },
          ac.signal,
        ).then((r) => r.items).catch(() => [] as PlannableItem[])
        if (ac.signal.aborted) return
        const byKey = new Map(plannable.map((p) => [balanceKey(p), p]))
        const initIds = new Set<string>()
        setCargoType(d.cargo_type)
        setClientId(d.client_id ?? '')
        setClientName(d.client_name)
        setShipDate(d.ship_date ?? '')
        setLogisticsCost(d.logistics_cost != null ? String(d.logistics_cost) : '')
        setComment(d.comment ?? '')
        setLines(d.lines.map((l) => {
          initIds.add(l.id)
          const p = byKey.get(balanceKey(l))
          return {
            _uid: `line-${uidSeq.current++}`,
            _key: balanceKey(l),
            _serverId: l.id,
            product_id: l.product_id,
            product_name: l.product_name,
            product_sku: l.product_sku,
            color_id: l.color_id,
            color_name: l.color_name,
            size_id: l.size_id,
            size_name: l.size_name,
            qty: l.qty,
            ready: d.cargo_type !== 'good' ? 0 : ((p?.ready_good ?? 0) + (p?.packed_good ?? 0)),
            onHand: d.cargo_type === 'defect' ? (p?.storage_defect ?? 0) : (p?.storage_good ?? 0),
            packing: d.cargo_type !== 'good' ? 0 : (p?.packing_good ?? 0),
            inTransit: d.cargo_type !== 'good' ? 0 : (p?.in_transit ?? 0),
            sku_pending: !!p?.sku_pending,
            itemsPerBox: l.items_per_box ?? p?.items_per_box ?? null,
            boxesPerPallet: l.boxes_per_pallet ?? p?.boxes_per_pallet ?? null,
            boxes: l.boxes_qty,
            boxesTouched: false,
            pallets: l.pallets_qty,
            palletsTouched: false,
            site_url: l.site_url,
            store_id: l.store_id,
            store_name: l.store_name,
            files: [],
          }
        }))
        initialServerIds.current = initIds
      } catch (e) {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : 'Не удалось загрузить документ')
      } finally {
        if (!ac.signal.aborted) setLoadingDoc(false)
      }
    })()
    return () => ac.abort()
  }, [docId])

  useEffect(() => {
    if (editing) return
    createdIdRef.current = null
  }, [editing, cargoType, clientId, shipDate, logisticsCost, comment, lines])

  useEffect(() => {
    if (!clientId) { setStores([]); return }
    const ac = new AbortController()
    getClientStores(clientId, ac.signal)
      .then((res) => { if (!ac.signal.aborted) setStores(res.filter((s) => s.is_active && !s.is_deleted)) })
      .catch(() => setStores([]))
    return () => ac.abort()
  }, [clientId])

  // Резервы по вариантам — строки показывают свободный остаток (минус обещанное другим
  // незакрытым отгрузкам), совпадая с серверным гейтом «В ожидание рейса».
  useEffect(() => {
    if (!clientId) { setReservedMap({}); return }
    const ac = new AbortController()
    getDispatchReservations({ client_id: clientId, cargo_type: cargoType }, ac.signal)
      .then((r) => {
        if (ac.signal.aborted) return
        const map: Record<string, number> = {}
        for (const rv of r.items) map[balanceKey(rv)] = rv.reserved
        setReservedMap(map)
      })
      .catch(() => setReservedMap({}))
    return () => ac.abort()
  }, [clientId, cargoType])

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const totalBoxes = lines.reduce((s, l) => s + (l.boxes ?? 0), 0)
  const totalPallets = lines.reduce((s, l) => s + (l.pallets ?? 0), 0)
  // Цену подсказываем, пока единица «релевантна»: не задана (null) либо задана >0.
  const needBoxPrice = lines.some((l) => (l.boxes ?? 1) > 0)
  const needPalletPrice = lines.some((l) => (l.pallets ?? 1) > 0)
  // Что можно передать на подготовку: годный — «Готов к отгрузке» (ready+packed) плюс
  // «На упаковке» (packing): последнее уйдёт в «Ожидание упаковки» и продолжится
  // автоматически по готовности (бэк паркует). Брак упаковку минует — только со склада.
  // Товар лишь на хранении/в пути пакуется отдельной задачей — его сохраняем черновиком.
  const reservedFor = (l: DraftLine) => reservedMap[l._key] ?? 0
  const srcAvail = (l: DraftLine) => Math.max(0, (bypassPacking ? l.onHand : l.ready) - reservedFor(l))
  const sendAvail = (l: DraftLine) => bypassPacking
    ? Math.max(0, l.onHand - reservedFor(l))
    : Math.max(0, l.ready + l.packing - reservedFor(l))
  const allSendable = lines.every((l) => l.qty <= sendAvail(l))
  const costNum = Number(logisticsCost)
  const costFilled = logisticsCost.trim() !== '' && Number.isFinite(costNum) && costNum >= 0

  const blockReasons: string[] = []
  if (!clientId) blockReasons.push('Выберите клиента')
  if (!shipDate) blockReasons.push('Укажите дату отгрузки')
  if (!costFilled) blockReasons.push('Укажите стоимость логистики')
  if (comment.trim() === '') blockReasons.push('Заполните техническое задание')
  if (lines.length === 0) blockReasons.push('Добавьте хотя бы одну позицию')
  if (lines.some((l) => l.sku_pending)) blockReasons.push('Укажите SKU для товаров без артикула')
  if (lines.some((l) => l.pallets == null)) blockReasons.push('Укажите количество палет для каждой позиции (можно 0)')
  if (lines.some((l) => l.boxes == null)) blockReasons.push('Укажите количество коробов для каждой позиции (можно 0)')
  if (!allSendable) blockReasons.push(
    isDefect
      ? 'Часть брака недоступна (на складе или в резерве у других отгрузок) — уменьшите количество'
      : isUnpacked
        ? 'Часть товара недоступна на хранении (нет остатка или в резерве у других отгрузок) — уменьшите количество'
        : 'Часть запрошенного нельзя передать на подготовку: товар лишь на хранении, ещё в пути или в резерве у других отгрузок — сохраните черновик',
  )

  function changeClient(id: string, name: string | null) {
    if (lines.length > 0) return
    setClientId(id)
    setClientName(name)
  }
  function changeCargo(next: DispatchCargoType) {
    if (next === cargoType) return
    setCargoType(next)
    setLines([])
  }

  const addMany = useCallback((rows: { item: PlannableItem; qty: number }[]) => {
    setLines((ls) => [
      ...ls,
      ...rows.map(({ item: b, qty }) => ({
        _uid: `line-${uidSeq.current++}`,
        _key: balanceKey(b),
        _serverId: null as string | null,
        product_id: b.product_id,
        product_name: b.product_name,
        product_sku: b.product_sku,
        color_id: b.color_id,
        color_name: b.color_name,
        size_id: b.size_id,
        size_name: b.size_name,
        qty,
        ready: cargoType !== 'good' ? 0 : b.ready_good + (b.packed_good ?? 0),
        onHand: cargoType === 'defect' ? b.storage_defect : b.storage_good,
        packing: cargoType !== 'good' ? 0 : (b.packing_good ?? 0),
        inTransit: cargoType !== 'good' ? 0 : b.in_transit,
        sku_pending: !!b.sku_pending,
        itemsPerBox: b.items_per_box,
        boxesPerPallet: b.boxes_per_pallet,
        boxes: recommendedBoxes(qty, b.items_per_box),
        boxesTouched: false,
        pallets: recommendedPallets(recommendedBoxes(qty, b.items_per_box), b.boxes_per_pallet),
        palletsTouched: false,
        site_url: null as string | null,
        store_id: null as string | null,
        store_name: null as string | null,
        files: [] as File[],
      })),
    ])
    setShowPicker(false)
  }, [cargoType])

  function setQty(uid: string, qty: number) {
    setLines((ls) => ls.map((l) => {
      if (l._uid !== uid) return l
      const nextQty = Math.max(1, Math.floor(qty))
      // Пока менеджер не правил вручную — держим рекомендацию из кратности.
      // Цепочка: короба из штук, палеты из коробов (палета меряется в коробах).
      const boxes = l.boxesTouched ? l.boxes : (recommendedBoxes(nextQty, l.itemsPerBox) ?? l.boxes)
      const pallets = l.palletsTouched ? l.pallets : (recommendedPallets(boxes, l.boxesPerPallet) ?? l.pallets)
      return { ...l, qty: nextQty, boxes, pallets }
    }))
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
  function setPallets(uid: string, value: number | null) {
    setLines((ls) => ls.map((l) => (l._uid === uid
      ? { ...l, pallets: value == null ? null : Math.max(0, value), palletsTouched: true }
      : l)))
  }
  function removeLine(uid: string) {
    setLines((ls) => ls.filter((l) => l._uid !== uid))
  }
  function setStore(uid: string, storeId: string, storeName: string | null) {
    setLines((ls) => ls.map((l) => (l._uid === uid ? { ...l, store_id: storeId || null, store_name: storeId ? storeName : null } : l)))
  }
  function setSiteUrl(uid: string, url: string) {
    setLines((ls) => ls.map((l) => (l._uid === uid ? { ...l, site_url: url || null } : l)))
  }
  function addFiles(uid: string, files: File[]) {
    for (const f of files) {
      const bad = validateFile(f)
      if (bad) { setError(`${f.name}: ${bad}`); return }
    }
    setError('')
    setLines((ls) => ls.map((l) => (l._uid === uid ? { ...l, files: [...l.files, ...files] } : l)))
  }
  function removeFile(uid: string, idx: number) {
    setLines((ls) => ls.map((l) => (l._uid === uid ? { ...l, files: l.files.filter((_, i) => i !== idx) } : l)))
  }
  function applySku(line: DraftLine, skuBase: string) {
    setLines((ls) => ls.map((l) => (l.product_id === line.product_id ? { ...l, sku_pending: false, product_sku: skuBase } : l)))
    setSkuLine(null)
  }

  // Кратность живёт на товаре — правка обновляет все строки с этим product_id и освежает
  // рекомендации по осям, которые менеджер не трогал вручную.
  async function saveMultiplicity(line: DraftLine, patch: { items_per_box: number | null; boxes_per_pallet: number | null }): Promise<boolean> {
    try {
      await updateProductMultiplicity(line.product_id, patch)
      setLines((ls) => ls.map((l) => {
        if (l.product_id !== line.product_id) return l
        const itemsPerBox = patch.items_per_box
        const boxesPerPallet = patch.boxes_per_pallet
        const boxes = l.boxesTouched ? l.boxes : (recommendedBoxes(l.qty, itemsPerBox) ?? l.boxes)
        const pallets = l.palletsTouched ? l.pallets : (recommendedPallets(boxes, boxesPerPallet) ?? l.pallets)
        return { ...l, itemsPerBox, boxesPerPallet, boxes, pallets }
      }))
      setMultiLine(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  function lineToIn(l: DraftLine): DispatchLineIn {
    return {
      product_id: l.product_id,
      product_name: l.product_name,
      product_sku: l.product_sku,
      color_id: l.color_id,
      color_name: l.color_name,
      size_id: l.size_id,
      size_name: l.size_name,
      qty: l.qty,
      pallets_qty: l.pallets,
      boxes_qty: l.boxes,
      site_url: l.site_url ?? null,
      store_id: l.store_id ?? null,
      store_name: l.store_name ?? null,
    }
  }

  // Создание: файлы стейджатся локально (у строк формы ещё нет id) и грузятся после
  // создания — матчим строку черновика к созданной по варианту + магазину + ссылке.
  async function uploadDraftFiles(docId: string): Promise<void> {
    const withFiles = lines.filter((l) => l.files.length > 0)
    if (withFiles.length === 0) return
    const detail = await getDispatch(docId)
    const used = new Set<string>()
    for (const draft of withFiles) {
      const target = detail.lines.find((cl) =>
        !used.has(cl.id) &&
        balanceKey(cl) === draft._key &&
        (cl.store_id ?? null) === (draft.store_id ?? null) &&
        (cl.site_url ?? null) === (draft.site_url ?? null))
      if (!target) continue
      used.add(target.id)
      for (const file of draft.files) {
        await uploadDispatchLineFile(docId, target.id, file)
      }
    }
  }

  // Правка черновика: PATCH реквизитов + синхронизация строк. Существующие строки
  // правим частично (qty/ссылка/магазин), новые добавляем, исчезнувшие удаляем.
  async function saveEdit(id: string): Promise<void> {
    await updateDispatch(id, {
      cargo_type: cargoType,
      client_id: clientId,
      client_name: clientName,
      ship_date: shipDate || null,
      logistics_cost: costFilled ? costNum : null,
      comment: comment.trim() || null,
    })
    const present = new Set<string>()
    for (const l of lines) {
      if (l._serverId) {
        present.add(l._serverId)
        await updateDispatchLine(id, l._serverId, {
          qty: l.qty,
          pallets_qty: l.pallets,
          boxes_qty: l.boxes,
          site_url: l.site_url ?? null,
          store_id: l.store_id ?? null,
          store_name: l.store_name ?? null,
        })
        for (const file of l.files) await uploadDispatchLineFile(id, l._serverId, file)
      } else {
        const res = await addDispatchLine(id, lineToIn(l))
        const newLineId = res.message
        for (const file of l.files) await uploadDispatchLineFile(id, newLineId, file)
      }
    }
    for (const oldId of initialServerIds.current) {
      if (!present.has(oldId)) await deleteDispatchLine(id, oldId)
    }
  }

  async function save(advance: boolean) {
    if (saving) return
    if (advance && blockReasons.length > 0) { setError(blockReasons[0]); return }
    if (!clientId) { setError('Выберите клиента'); return }
    if (advance && lines.length === 0) { setError('Добавьте хотя бы одну позицию'); return }
    setError('')
    // Дубль ищем только для нового документа (не правка, черновик ещё не создан).
    if (!editing && !createdIdRef.current) {
      setSaving(true)
      try {
        const dup = await checkDispatchDuplicate({
          cargo_type: cargoType,
          client_id: clientId,
          ship_date: shipDate || null,
          lines: lines.map((l) => ({ product_id: l.product_id, color_id: l.color_id ?? null, size_id: l.size_id ?? null, qty: l.qty })),
        })
        if (dup.matches.length > 0) {
          pendingAdvanceRef.current = advance
          setDupMatches(dup.matches)
          setSaving(false)
          return
        }
      } catch { /* проверка на дубль не критична — не блокируем создание */ }
      setSaving(false)
    }
    await runSave(advance)
  }

  async function runSave(advance: boolean) {
    setError('')
    setSaving(true)
    try {
      let id = docId as string
      if (editing) {
        await saveEdit(id)
      } else if (createdIdRef.current) {
        id = createdIdRef.current
      } else {
        const res = await createDispatch({
          cargo_type: cargoType,
          client_id: clientId,
          client_name: clientName,
          ship_date: shipDate || null,
          logistics_cost: costFilled ? costNum : null,
          comment: comment.trim() || null,
          lines: lines.map(lineToIn),
        })
        id = res.message
        createdIdRef.current = id
        await uploadDraftFiles(id)
      }
      if (advance) await advanceDispatch(id)
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      setSaving(false)
    }
  }

  const storeOptions = stores.map((s) => ({ value: s.id, label: s.name }))

  if (loadingDoc) {
    return (
      <div className="screen">
        <AppBar title="Отгрузка" sub="Загрузка…" onBack={back} noProfile />
        <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
      </div>
    )
  }

  return (
    <div className="screen">
      <AppBar
        title={editing ? 'Изменить отгрузку' : 'Новая отгрузка'}
        sub={editing ? 'Черновик · правка состава и реквизитов' : 'Номер присвоится при сохранении'}
        onBack={back}
        noProfile
      />
      <div className="scroll pad-nav">
        <div className="line-row" style={{ marginTop: 0, marginBottom: 12 }}>
          <button className={cargoType === 'good' ? 'btn' : 'btn ghost'} style={{ flex: 1 }} onClick={() => changeCargo('good')}>
            Товар
          </button>
          <button className={cargoType === 'good_unpacked' ? 'btn' : 'btn ghost'} style={{ flex: 1 }} onClick={() => changeCargo('good_unpacked')}>
            Без упаковки
          </button>
          <button className={cargoType === 'defect' ? 'btn' : 'btn ghost'} style={{ flex: 1 }} onClick={() => changeCargo('defect')}>
            Брак
          </button>
        </div>

        <div className="field">
          <div className="flabel">Клиент <span className="req">*</span></div>
          <Combobox
            value={clientId}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Выберите клиента…"
            title="Клиент"
            onChange={(v) => changeClient(v, clients.find((c) => c.id === v)?.name ?? null)}
          />
          {lines.length > 0 && <div className="line-sub" style={{ marginTop: 4 }}>Удалите строки, чтобы сменить клиента</div>}
        </div>

        <div className="field">
          <div className="flabel">Дата отгрузки (план) <span className="req">*</span></div>
          <DateField value={shipDate} onChange={setShipDate} title="Дата отгрузки" />
        </div>

        <div className="field">
          <div className="flabel">Стоимость логистики для клиента, ₽ <span className="req">*</span></div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="0"
            value={logisticsCost}
            onChange={(e) => setLogisticsCost(e.target.value.replace(/[^\d]/g, ''))}
          />
        </div>

        <div className="field">
          <div className="flabel">Техническое задание <span className="req">*</span></div>
          <TextArea
            placeholder="Опишите задачу для команды склада"
            value={comment}
            onChange={setComment}
          />
        </div>

        {clientId && (needBoxPrice || needPalletPrice) && (
          <PackPriceBanner clientId={clientId} needBoxPrice={needBoxPrice} needPalletPrice={needPalletPrice} />
        )}

        <div className="sec" style={{ marginTop: 4 }}>
          Состав
          <span className="sec-count">{lines.length}</span>
        </div>

        {lines.length === 0 ? (
          <div className="line-sub" style={{ padding: '8px 0 12px' }}>
            {clientId ? 'Нажмите «Добавить товар».' : 'Сначала выберите клиента.'}
          </div>
        ) : (
          lines.map((l) => {
            const reserved = reservedFor(l)
            const freeQ = srcAvail(l)
            const overCap = l.qty > l.ready + l.packing + l.onHand + l.inTransit
            const waiting = !overCap && l.qty > freeQ
            const fullySet = l.itemsPerBox != null && l.boxesPerPallet != null
            // Предложение = целочисленное деление введённых вручную чисел, если ось ещё не
            // задана. Короб: шт ÷ коробов. Палета: коробов ÷ палет (меряется в коробах).
            const suggestPerBox = l.boxesTouched && l.itemsPerBox == null
              && l.boxes != null && l.boxes > 0 && l.qty % l.boxes === 0 ? l.qty / l.boxes : null
            const suggestPerPallet = l.palletsTouched && l.boxesPerPallet == null
              && l.pallets != null && l.pallets > 0 && l.boxes != null && l.boxes > 0 && l.boxes % l.pallets === 0 ? l.boxes / l.pallets : null
            return (
              <div key={l._uid} className="formline">
                <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                    <div className="tile-meta">{lineSub(l)}</div>
                    <div className="tile-meta">
                      {`свободно ${freeQ}`}
                      {reserved > 0 ? ` · ${isDefect ? 'брак' : isUnpacked ? 'склад' : 'упаковано'} ${bypassPacking ? l.onHand : l.ready}, в резерве ${reserved}` : ''}
                      {!bypassPacking && l.packing > 0 ? ` · на упаковке ${l.packing}` : ''}
                      {!bypassPacking && l.onHand > 0 ? ` · склад ${l.onHand}` : ''}
                      {!bypassPacking && l.inTransit > 0 && <> · <span className="hint-warn">в пути {l.inTransit}</span></>}
                      {overCap ? <> · <span className="hint-danger">превышение</span></> : waiting ? <> · <span className="hint-warn">сверх свободного</span></> : ''}
                    </div>
                  </div>
                  <button className="icon-btn danger" onClick={() => removeLine(l._uid)} aria-label="Удалить">
                    <Icon name="trash" size={15} />
                  </button>
                </div>

                <div className="line-row" style={{ marginTop: 8, gap: 6 }}>
                  <input
                    className="input num"
                    inputMode="numeric"
                    value={l.qty ? String(l.qty) : ''}
                    placeholder="0"
                    aria-label="Количество"
                    onChange={(e) => setQty(l._uid, parseInt(e.target.value.replace(/\D/g, ''), 10) || 1)}
                  />
                  <div style={{ flex: 1 }}>
                    <Combobox
                      value={l.store_id ?? ''}
                      options={storeOptions}
                      placeholder="Без магазина"
                      title="Магазин"
                      onChange={(v) => setStore(l._uid, v, stores.find((s) => s.id === v)?.name ?? null)}
                    />
                  </div>
                </div>

                <div className="line-row" style={{ marginTop: 8, gap: 6, alignItems: 'center' }}>
                  <input
                    className="input num"
                    inputMode="numeric"
                    value={l.boxes != null ? String(l.boxes) : ''}
                    placeholder="Короба"
                    aria-label="Количество коробов"
                    style={l.boxes == null ? { borderColor: 'var(--c-warning)' } : undefined}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '')
                      setBoxes(l._uid, raw === '' ? null : parseInt(raw, 10))
                    }}
                  />
                  <div className="line-sub" style={{ flex: 1 }}>
                    {l.itemsPerBox
                      ? `короба · реком. ${recommendedBoxes(l.qty, l.itemsPerBox)} (${l.itemsPerBox} шт/кор)`
                      : 'короба · кратность не задана'}
                  </div>
                </div>

                <div className="line-row" style={{ marginTop: 8, gap: 6, alignItems: 'center' }}>
                  <input
                    className="input num"
                    inputMode="numeric"
                    value={l.pallets != null ? String(l.pallets) : ''}
                    placeholder="Палеты"
                    aria-label="Количество палет"
                    style={l.pallets == null ? { borderColor: 'var(--c-warning)' } : undefined}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '')
                      setPallets(l._uid, raw === '' ? null : parseInt(raw, 10))
                    }}
                  />
                  <div className="line-sub" style={{ flex: 1 }}>
                    {l.boxesPerPallet
                      ? `палеты · реком. ${recommendedPallets(l.boxes, l.boxesPerPallet) ?? '—'} (${l.boxesPerPallet} кор/пал)`
                      : 'палеты · кратность не задана'}
                  </div>
                </div>

                <div className="line-row" style={{ marginTop: 8, gap: 6, flexWrap: 'wrap' }}>
                  {suggestPerBox != null && (
                    <button
                      type="button"
                      className="badge success"
                      style={{ border: 'none', cursor: 'pointer' }}
                      onClick={() => void saveMultiplicity(l, { items_per_box: suggestPerBox, boxes_per_pallet: l.boxesPerPallet })}
                    >
                      <Icon name="sparkles" size={11} /> {suggestPerBox} шт/короб — сохранить?
                    </button>
                  )}
                  {suggestPerPallet != null && (
                    <button
                      type="button"
                      className="badge success"
                      style={{ border: 'none', cursor: 'pointer' }}
                      onClick={() => void saveMultiplicity(l, { items_per_box: l.itemsPerBox, boxes_per_pallet: suggestPerPallet })}
                    >
                      <Icon name="sparkles" size={11} /> {suggestPerPallet} кор/палет — сохранить?
                    </button>
                  )}
                  <button
                    type="button"
                    className={fullySet ? 'badge success' : 'badge accent'}
                    style={{ border: 'none', cursor: 'pointer', marginLeft: 'auto' }}
                    onClick={() => setMultiLine(l)}
                  >
                    <Icon name={fullySet ? 'box' : 'plus'} size={11} />
                    {fullySet ? ` ${l.itemsPerBox} шт/кор · ${l.boxesPerPallet} кор/пал` : ' Задать кратность'}
                  </button>
                </div>

                <div className="line-row" style={{ marginTop: 8 }}>
                  <input
                    className="input"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder="Ссылка на сайт (необязательно)"
                    value={l.site_url ?? ''}
                    onChange={(e) => setSiteUrl(l._uid, e.target.value)}
                  />
                </div>

                <div className="line-row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                  {l.files.map((f, i) => (
                    <span key={i} className="filechip">
                      <Icon name="file" size={12} />
                      <span className="fc-name">{f.name}</span>
                      <button className="fc-x" onClick={() => removeFile(l._uid, i)} aria-label="Убрать файл">
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  ))}
                  <label className="btn ghost sm auto" style={{ cursor: 'pointer' }}>
                    <Icon name="file" size={13} /> Файл
                    <input
                      type="file"
                      hidden
                      multiple
                      accept=".zip,.pdf,.jpg,.jpeg"
                      onChange={(e) => {
                        addFiles(l._uid, Array.from(e.target.files ?? []))
                        e.target.value = ''
                      }}
                    />
                  </label>
                </div>

                {l.sku_pending && (
                  <div className="line-row" style={{ marginTop: 8 }}>
                    <span className="badge warning"><span className="dot" />Без SKU</span>
                    <button className="btn ghost" style={{ flex: 1 }} onClick={() => setSkuLine(l)}>
                      <Icon name="edit" size={13} /> Указать SKU
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}

        <button className="btn ghost" style={{ marginTop: 10 }} disabled={!clientId} onClick={() => setShowPicker(true)}>
          <Icon name="plus" size={15} /> Добавить товар
        </button>

        {lines.length > 0 && (
          <div className="summary" style={{ marginTop: 16 }}>
            <div className="kv"><span className="k">SKU</span><span className="v mono">{lines.length}</span></div>
            <div className="kv"><span className="k">Кол-во</span><span className="v mono">{totalQty} шт</span></div>
            <div className="kv"><span className="k">Коробов</span><span className="v mono">{totalBoxes}</span></div>
            <div className="kv"><span className="k">Палет</span><span className="v mono">{totalPallets}</span></div>
          </div>
        )}

        {error && (
          <div className="alert" style={{ marginTop: 12 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} disabled={saving || !clientId} onClick={() => void save(false)}>
            {editing ? 'Сохранить' : 'Черновик'}
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving || blockReasons.length > 0} onClick={() => void save(true)}>
            {saving ? <span className="spin spin-sm" /> : 'В ожидание рейса'}
          </button>
        </div>
      </div>

      {showPicker && (
        <BalancePickerSheet
          clientId={clientId}
          cargoType={cargoType}
          source="dispatch"
          existingKeys={lines.map((l) => l._key)}
          onAddMany={addMany}
          onClose={() => setShowPicker(false)}
        />
      )}

      {skuLine && (
        <AssignSkuSheet
          productId={skuLine.product_id}
          productName={skuLine.product_name}
          variantLabel={[skuLine.color_name, skuLine.size_name].filter(Boolean).join(' · ') || null}
          currentSku={skuLine.sku_pending ? null : skuLine.product_sku}
          onDone={(sku) => applySku(skuLine, sku)}
          onClose={() => setSkuLine(null)}
        />
      )}

      {multiLine && (
        <PackMultiplicitySheet
          productName={multiLine.product_name}
          itemsPerBox={multiLine.itemsPerBox}
          boxesPerPallet={multiLine.boxesPerPallet}
          onSave={(patch) => saveMultiplicity(multiLine, patch)}
          onClose={() => setMultiLine(null)}
        />
      )}

      {dupMatches.length > 0 && (
        <DuplicateWarnSheet
          matches={dupMatches}
          busy={saving}
          onOpenExisting={(id) => openDispatchDoc(id)}
          onProceed={() => { setDupMatches([]); void runSave(pendingAdvanceRef.current) }}
          onCancel={() => setDupMatches([])}
        />
      )}
    </div>
  )
}
