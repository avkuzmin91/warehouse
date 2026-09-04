import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  createShipment,
  updateShipment,
  addShipmentLine,
  updateShipmentLine,
  deleteShipmentLine,
  advanceShipment,
  getShipment,
  uploadShipmentLineFile,
  type LineFileBarcode,
  type ShipmentLineIn,
} from '../../api/shipmentsApi'
import { addProductBarcode, addProductBarcodeFile, getProductFiles, type ProductFileItem } from '../../api/productsApi'
import { attachShipmentLineFileFromProduct } from '../../api/shipmentsApi'
import { newRequestId } from '../../api/http'
import { getClients, getClientStores, type DictionaryItem, type ClientStoreItem } from '../../api/lookupsApi'
import { getPlannableItems, type PlannableItem, type InvQuality } from '../../api/balancesApi'
import { balanceKey } from '../../utils/balanceKey'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { DateField } from '../../components/DateField'
import { TextArea } from '../../components/TextArea'
import { Icon } from '../../components/Icon'
import { BalancePickerSheet } from './BalancePickerSheet'
import { AssignSkuSheet } from './AssignSkuSheet'
import { Sheet } from '../../components/Sheet'

const ALLOWED_EXTS = ['pdf', 'png', 'jpg', 'jpeg']
const MAX_BYTES = 10 * 1024 * 1024

function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED_EXTS.includes(ext)) return 'Допустимы PDF, PNG, JPG'
  if (file.size > MAX_BYTES) return 'Файл больше 10 МБ'
  return null
}

type DraftLine = ShipmentLineIn & {
  _uid: string
  _key: string
  _serverId: string | null
  onHand: number
  inTransit: number
  sku_pending: boolean
  files: File[]
  productFiles: ProductFileItem[]
}

function lineSub(l: DraftLine): string {
  return [l.product_sku || 'без SKU', l.color_name, l.size_name].filter(Boolean).join(' · ')
}

type BcFinding = LineFileBarcode & { file: File; productId: string; productName: string; variantLabel: string; lineVariantId: string | null }

export function ShipmentFormScreen({ docId }: { docId?: string } = {}) {
  const { back } = useNav()
  const editing = !!docId
  const [cargoType, setCargoType] = useState<InvQuality>('good')
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [clientId, setClientId] = useState('')
  const [clientName, setClientName] = useState<string | null>(null)
  const [stores, setStores] = useState<ClientStoreItem[]>([])
  const [shipDate, setShipDate] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [skuLine, setSkuLine] = useState<DraftLine | null>(null)
  const [loadingDoc, setLoadingDoc] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const uidSeq = useRef(0)
  const initialServerIds = useRef<Set<string>>(new Set())

  const isDefect = cargoType === 'defect'

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
        const d = await getShipment(docId, ac.signal)
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
        setComment(d.comment ?? '')
        docNumberRef.current = d.doc_number
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
            onHand: d.cargo_type === 'defect' ? (p?.storage_defect ?? 0) : (p?.storage_good ?? 0),
            inTransit: d.cargo_type === 'defect' ? 0 : (p?.in_transit ?? 0),
            sku_pending: !!p?.sku_pending,
            store_id: l.store_id,
            store_name: l.store_name,
            files: [],
            productFiles: [],
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
    if (!clientId) { setStores([]); return }
    const ac = new AbortController()
    getClientStores(clientId, ac.signal)
      .then((res) => { if (!ac.signal.aborted) setStores(res.filter((s) => s.is_active && !s.is_deleted)) })
      .catch(() => setStores([]))
    return () => ac.abort()
  }, [clientId])

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const allOnStock = lines.every((l) => l.qty <= l.onHand)

  const blockReasons: string[] = []
  if (!clientId) blockReasons.push('Выберите клиента')
  if (!shipDate) blockReasons.push('Укажите дату упаковки')
  if (!isDefect && comment.trim() === '') blockReasons.push('Заполните техническое задание')
  if (lines.length === 0) blockReasons.push('Добавьте хотя бы одну позицию')
  if (lines.some((l) => l.sku_pending)) blockReasons.push('Укажите SKU для товаров без артикула')
  if (!allOnStock) blockReasons.push('Часть товара ещё в пути — сохраните черновик и запланируйте после прихода')

  function changeClient(id: string, name: string | null) {
    if (lines.length > 0) return
    setClientId(id)
    setClientName(name)
  }

  function changeCargo(next: InvQuality) {
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
        onHand: cargoType === 'defect' ? b.storage_defect : b.storage_good,
        inTransit: cargoType === 'defect' ? 0 : b.in_transit,
        sku_pending: !!b.sku_pending,
        store_id: null as string | null,
        store_name: null as string | null,
        files: [] as File[],
        productFiles: [] as ProductFileItem[],
      })),
    ])
    setShowPicker(false)
  }, [cargoType])

  function setQty(uid: string, qty: number) {
    setLines((ls) => ls.map((l) => (l._uid === uid ? { ...l, qty: Math.max(1, Math.floor(qty)) } : l)))
  }
  function removeLine(uid: string) {
    setLines((ls) => ls.filter((l) => l._uid !== uid))
  }
  function setStore(uid: string, storeId: string, storeName: string | null) {
    setLines((ls) => ls.map((l) => (l._uid === uid ? { ...l, store_id: storeId || null, store_name: storeId ? storeName : null } : l)))
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

  function lineToIn(l: DraftLine): ShipmentLineIn {
    return {
      product_id: l.product_id,
      product_name: l.product_name,
      product_sku: l.product_sku,
      color_id: l.color_id,
      color_name: l.color_name,
      size_id: l.size_id,
      size_name: l.size_name,
      qty: l.qty,
      store_id: l.store_id ?? null,
      store_name: l.store_name ?? null,
    }
  }

  // Итог распознавания ШК на файлах — копится за время сохранения, показывается
  // одной шторкой перед выходом с формы.
  const bcFindingsRef = useRef<BcFinding[]>([])
  const docNumberRef = useRef('')

  function collectFindings(res: { barcodes?: LineFileBarcode[]; line_variant_id?: string | null }, l: DraftLine, file: File) {
    for (const b of res.barcodes ?? []) {
      bcFindingsRef.current.push({
        ...b, file,
        productId: l.product_id,
        productName: l.product_name,
        variantLabel: [l.color_name, l.size_name].filter(Boolean).join(' / '),
        lineVariantId: res.line_variant_id ?? null,
      })
    }
  }

  // Создание: файлы грузим после получения id строк (матч по ключу+магазину).
  async function uploadDraftFiles(docId: string) {
    const withFiles = lines.filter((l) => l.files.length > 0 || l.productFiles.length > 0)
    if (withFiles.length === 0) return
    const detail = await getShipment(docId)
    docNumberRef.current = detail.doc_number
    const used = new Set<string>()
    for (const draft of withFiles) {
      const target = detail.lines.find((cl) =>
        !used.has(cl.id) && balanceKey(cl) === draft._key && (cl.store_id ?? null) === (draft.store_id ?? null))
      if (!target) continue
      used.add(target.id)
      for (const file of draft.files) {
        const res = await uploadShipmentLineFile(docId, target.id, file)
        collectFindings(res, draft, file)
      }
      for (const pf of draft.productFiles) {
        // Дубль этикетки на строке (повторное сохранение) — не ошибка, пропускаем.
        await attachShipmentLineFileFromProduct(docId, target.id, pf.id).catch(() => {})
      }
    }
  }

  async function saveCreate(): Promise<string> {
    const res = await createShipment({
      cargo_type: cargoType,
      client_id: clientId,
      client_name: clientName,
      ship_date: shipDate || null,
      comment: comment.trim() || null,
      lines: lines.map(lineToIn),
    })
    const newId = res.message
    await uploadDraftFiles(newId)
    return newId
  }

  // Правка: PATCH реквизитов + синхронизация строк (новые → POST, изменённые → PATCH,
  // удалённые → DELETE). Новые файлы догружаем по серверным id строк.
  async function saveEdit(id: string): Promise<void> {
    await updateShipment(id, {
      cargo_type: cargoType,
      client_id: clientId,
      client_name: clientName,
      ship_date: shipDate || null,
      comment: comment.trim() || null,
    })
    const present = new Set<string>()
    for (const l of lines) {
      if (l._serverId) {
        present.add(l._serverId)
        await updateShipmentLine(id, l._serverId, lineToIn(l))
        for (const file of l.files) {
          const res = await uploadShipmentLineFile(id, l._serverId, file)
          collectFindings(res, l, file)
        }
        for (const pf of l.productFiles) {
          await attachShipmentLineFileFromProduct(id, l._serverId, pf.id).catch(() => {})
        }
      } else {
        const res = await addShipmentLine(id, lineToIn(l))
        const newLineId = res.message
        for (const file of l.files) {
          const up = await uploadShipmentLineFile(id, newLineId, file)
          collectFindings(up, l, file)
        }
        for (const pf of l.productFiles) {
          await attachShipmentLineFileFromProduct(id, newLineId, pf.id).catch(() => {})
        }
      }
    }
    for (const oldId of initialServerIds.current) {
      if (!present.has(oldId)) await deleteShipmentLine(id, oldId)
    }
  }

  async function save(plan: boolean) {
    if (saving) return
    if (plan && blockReasons.length > 0) { setError(blockReasons[0]); return }
    if (!clientId || lines.length === 0) { setError('Выберите клиента и добавьте позиции'); return }
    setError('')
    setSaving(true)
    bcFindingsRef.current = []
    try {
      const id = editing ? (docId as string) : await saveCreate()
      if (editing) await saveEdit(id)
      if (plan) await advanceShipment(id, newRequestId())
      const seen = new Set<string>()
      const uniq = bcFindingsRef.current.filter((f) => !seen.has(f.code) && (seen.add(f.code), true))
      const unknown = uniq.filter((f) => f.status === 'unknown' && f.lineVariantId)
      const foreign = uniq.filter((f) => f.status === 'other_product' || f.status === 'other_variant')
      if (unknown.length > 0 || foreign.length > 0) {
        setSaving(false)
        setBcOffer({ unknown, foreign })
        return
      }
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      setSaving(false)
    }
  }

  const [bcOffer, setBcOffer] = useState<{ unknown: BcFinding[]; foreign: BcFinding[] } | null>(null)
  const [bcSaving, setBcSaving] = useState(false)
  const [bcSaveLabel, setBcSaveLabel] = useState(true)

  async function attachOfferedBarcodes() {
    if (!bcOffer || bcSaving) return
    setBcSaving(true)
    try {
      for (const f of bcOffer.unknown) {
        const res = await addProductBarcode(f.productId, { barcode: f.code, source: `Упаковка ${docNumberRef.current}`.trim() })
        if (bcSaveLabel) await addProductBarcodeFile(f.productId, res.message, f.file)
      }
      setBcOffer(null)
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось привязать штрих-код')
      setBcOffer(null)
      setBcSaving(false)
    }
  }

  // Выбор этикетки из карточки товара для строки черновика.
  const [labelPickLine, setLabelPickLine] = useState<DraftLine | null>(null)
  const [labelPickFiles, setLabelPickFiles] = useState<ProductFileItem[] | null>(null)

  useEffect(() => {
    if (!labelPickLine) { setLabelPickFiles(null); return }
    const ac = new AbortController()
    getProductFiles(labelPickLine.product_id, ac.signal)
      .then((res) => { if (!ac.signal.aborted) setLabelPickFiles(res) })
      .catch(() => { if (!ac.signal.aborted) setLabelPickFiles([]) })
    return () => ac.abort()
  }, [labelPickLine])

  function addProductFileRef(uid: string, file: ProductFileItem) {
    setLines((ls) => ls.map((l) => l._uid === uid && !l.productFiles.some((f) => f.id === file.id)
      ? { ...l, productFiles: [...l.productFiles, file] }
      : l))
  }

  function removeProductFileRef(uid: string, fileId: string) {
    setLines((ls) => ls.map((l) => l._uid === uid
      ? { ...l, productFiles: l.productFiles.filter((f) => f.id !== fileId) }
      : l))
  }

  const storeOptions = stores.map((s) => ({ value: s.id, label: s.name }))

  if (loadingDoc) {
    return (
      <div className="screen">
        <AppBar title="Задача упаковки" sub="Загрузка…" onBack={back} noProfile />
        <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
      </div>
    )
  }

  return (
    <div className="screen">
      <AppBar
        title={editing ? 'Изменить задачу упаковки' : 'Новая задача упаковки'}
        sub={editing ? 'Черновик · правка состава и реквизитов' : 'Номер присвоится при сохранении'}
        onBack={back}
        noProfile
      />
      <div className="scroll pad-nav">
        <div className="line-row" style={{ marginTop: 0, marginBottom: 12 }}>
          <button className={cargoType === 'good' ? 'btn' : 'btn ghost'} style={{ flex: 1 }} onClick={() => changeCargo('good')}>
            Годный товар
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
          <div className="flabel">Дата упаковки (план) <span className="req">*</span></div>
          <DateField value={shipDate} onChange={setShipDate} title="Дата упаковки" />
        </div>

        <div className="field">
          <div className="flabel">Техническое задание {!isDefect && <span className="req">*</span>}</div>
          <TextArea
            placeholder="Опишите задачу для команды склада"
            value={comment}
            onChange={setComment}
          />
        </div>

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
            const overCap = l.qty > l.onHand + l.inTransit
            const waiting = !overCap && l.qty > l.onHand
            return (
              <div key={l._uid} className="formline">
                <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                    <div className="tile-meta">{lineSub(l)}</div>
                    <div className="tile-meta">
                      склад {l.onHand}
                      {!isDefect && l.inTransit > 0 && <> · <span className="hint-warn">в пути {l.inTransit}</span></>}
                      {overCap ? <> · <span className="hint-danger">превышение</span></> : waiting ? <> · <span className="hint-warn">ждёт прихода</span></> : ''}
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

                {l.sku_pending && (
                  <div className="line-row" style={{ marginTop: 8 }}>
                    <span className="badge warning"><span className="dot" />Без SKU</span>
                    <button className="btn ghost" style={{ flex: 1 }} onClick={() => setSkuLine(l)}>
                      <Icon name="edit" size={13} /> Указать SKU
                    </button>
                  </div>
                )}

                <div className="line-row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
                  {l.productFiles.map((f) => (
                    <span key={f.id} className="filechip" title={`Этикетка ${f.barcode}`}>
                      <Icon name="tag" size={12} />
                      <span className="fc-name">{f.filename}</span>
                      <button className="fc-x" onClick={() => removeProductFileRef(l._uid, f.id)} aria-label="Убрать этикетку">
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  ))}
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
                    <Icon name="file" size={13} /> Файл ТЗ
                    <input
                      type="file"
                      hidden
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,image/*,application/pdf"
                      onChange={(e) => {
                        addFiles(l._uid, Array.from(e.target.files ?? []))
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <button className="btn ghost sm auto" onClick={() => setLabelPickLine(l)}>
                    <Icon name="tag" size={13} /> Из карточки
                  </button>
                </div>
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
          </div>
        )}

        {error && (
          <div className="alert" style={{ marginTop: 12 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} disabled={saving || !clientId || lines.length === 0} onClick={() => void save(false)}>
            {editing ? 'Сохранить' : 'Черновик'}
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving || blockReasons.length > 0} onClick={() => void save(true)}>
            {saving ? <span className="spin spin-sm" /> : 'Запланировать'}
          </button>
        </div>
      </div>

      {showPicker && (
        <BalancePickerSheet
          clientId={clientId}
          cargoType={cargoType}
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

      {labelPickLine && (
        <Sheet onClose={() => setLabelPickLine(null)}>
          <h3>Этикетка из карточки товара</h3>
          <p className="line-sub" style={{ fontSize: 13, marginTop: 0 }}>{labelPickLine.product_name}</p>
          {labelPickFiles === null ? (
            <div className="center" style={{ padding: '16px 0' }}><div className="spin" /></div>
          ) : labelPickFiles.length === 0 ? (
            <p className="line-sub" style={{ fontSize: 13 }}>
              В карточке товара нет этикеток. Этикетка сохраняется при привязке распознанного ШК.
            </p>
          ) : (
            labelPickFiles
              .filter((f) => !labelPickLine.productFiles.some((pf) => pf.id === f.id))
              .filter((f) => f.variant_id === null ||
                ((f.color_id ?? null) === (labelPickLine.color_id ?? null) && (f.size_id ?? null) === (labelPickLine.size_id ?? null)))
              .map((f) => (
                <button
                  key={f.id}
                  className="tile"
                  style={{ width: '100%', marginBottom: 6 }}
                  onClick={() => { addProductFileRef(labelPickLine._uid, f); setLabelPickLine(null) }}
                >
                  <div className="tile-title" style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="tag" size={14} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
                  </div>
                  <div className="line-sub mono" style={{ fontSize: 12 }}>{f.barcode}</div>
                </button>
              ))
          )}
        </Sheet>
      )}

      {bcOffer && (
        <Sheet onClose={() => { setBcOffer(null); back() }} locked={bcSaving}>
          <h3>{bcOffer.unknown.length > 0 ? 'Привязать штрих-коды?' : 'Проверьте файлы'}</h3>
          {bcOffer.foreign.map((f) => (
            <p key={f.code} className="line-sub" style={{ fontSize: 13, marginTop: 0 }}>
              Код <span className="mono">{f.code}</span> принадлежит {f.status === 'other_variant'
                ? `варианту «${f.other_variant_label}» товара «${f.productName}» — возможен пересорт.`
                : `«${[f.other_product_name, f.other_variant_label].filter(Boolean).join(' · ')}» — проверьте, тот ли файл приложен.`}
            </p>
          ))}
          {bcOffer.unknown.length > 0 && (
            <p className="line-sub" style={{ fontSize: 13, marginTop: 0 }}>
              На файлах распознаны новые коды:{' '}
              {bcOffer.unknown.map((f) => `${f.code} → «${f.productName}»${f.variantLabel ? ` (${f.variantLabel})` : ''}`).join('; ')}. В системе их нет — привязать к вариантам?
            </p>
          )}
          {bcOffer.unknown.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
              <input
                type="checkbox"
                checked={bcSaveLabel}
                disabled={bcSaving}
                onChange={(e) => setBcSaveLabel(e.target.checked)}
              />
              Сохранить файлы этикеток в карточки товаров
            </label>
          )}
          <div className="dtf-actions">
            <button className="btn ghost" disabled={bcSaving} onClick={() => { setBcOffer(null); back() }}>
              {bcOffer.unknown.length > 0 ? 'Не привязывать' : 'Понятно'}
            </button>
            {bcOffer.unknown.length > 0 && (
              <button className="btn" disabled={bcSaving} onClick={() => void attachOfferedBarcodes()}>
                {bcSaving ? <span className="spin spin-sm" /> : 'Привязать'}
              </button>
            )}
          </div>
        </Sheet>
      )}
    </div>
  )
}
