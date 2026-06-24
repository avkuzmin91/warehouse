import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  createShipment,
  advanceShipment,
  getShipment,
  uploadShipmentLineFile,
  type ShipmentLineIn,
} from '../../api/shipmentsApi'
import { newRequestId } from '../../api/http'
import { getClients, getClientStores, type DictionaryItem, type ClientStoreItem } from '../../api/lookupsApi'
import type { PlannableItem, InvQuality } from '../../api/balancesApi'
import { balanceKey } from '../../utils/balanceKey'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { DateField } from '../../components/DateField'
import { Icon } from '../../components/Icon'
import { BalancePickerSheet } from './BalancePickerSheet'
import { AssignSkuSheet } from './AssignSkuSheet'

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
  onHand: number
  inTransit: number
  sku_pending: boolean
  files: File[]
}

function lineSub(l: DraftLine): string {
  return [l.product_sku || 'без SKU', l.color_name, l.size_name].filter(Boolean).join(' · ')
}

export function ShipmentFormScreen() {
  const { back } = useNav()
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const uidSeq = useRef(0)

  const isDefect = cargoType === 'defect'

  useEffect(() => {
    const ac = new AbortController()
    getClients(ac.signal)
      .then((res) => { if (!ac.signal.aborted) setClients(res.filter((c) => c.is_active !== false && !c.is_deleted)) })
      .catch(() => { /* aborted */ })
    return () => ac.abort()
  }, [])

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

  async function uploadDraftFiles(docId: string) {
    const withFiles = lines.filter((l) => l.files.length > 0)
    if (withFiles.length === 0) return
    const detail = await getShipment(docId)
    const used = new Set<string>()
    for (const draft of withFiles) {
      const target = detail.lines.find((cl) =>
        !used.has(cl.id) && balanceKey(cl) === draft._key && (cl.store_id ?? null) === (draft.store_id ?? null))
      if (!target) continue
      used.add(target.id)
      for (const file of draft.files) {
        await uploadShipmentLineFile(docId, target.id, file)
      }
    }
  }

  async function save(plan: boolean) {
    if (saving) return
    if (plan && blockReasons.length > 0) { setError(blockReasons[0]); return }
    if (!clientId || lines.length === 0) { setError('Выберите клиента и добавьте позиции'); return }
    setError('')
    setSaving(true)
    try {
      const res = await createShipment({
        cargo_type: cargoType,
        client_id: clientId,
        client_name: clientName,
        ship_date: shipDate || null,
        comment: comment.trim() || null,
        lines: lines.map((l) => ({
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
        })),
      })
      const docId = res.message
      await uploadDraftFiles(docId)
      if (plan) await advanceShipment(docId, newRequestId())
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      setSaving(false)
    }
  }

  const storeOptions = stores.map((s) => ({ value: s.id, label: s.name }))

  return (
    <div className="screen">
      <AppBar title="Новая задача упаковки" sub="Номер присвоится при сохранении" onBack={back} noProfile />
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
          <textarea
            className="input"
            rows={3}
            placeholder="Опишите задачу для команды склада"
            value={comment}
            onChange={(e) => {
              setComment(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${e.target.scrollHeight}px`
            }}
            style={{ resize: 'none', overflow: 'hidden' }}
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
            Черновик
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving || blockReasons.length > 0} onClick={() => void save(true)}>
            {saving ? '…' : 'Запланировать'}
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
    </div>
  )
}
