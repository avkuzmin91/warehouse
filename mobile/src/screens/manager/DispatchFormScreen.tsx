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
  type DispatchLineIn,
  type DispatchCargoType,
} from '../../api/dispatchApi'
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

type DraftLine = DispatchLineIn & {
  _uid: string
  _key: string
  _serverId: string | null
  ready: number
  onHand: number
  inTransit: number
  sku_pending: boolean
  itemsPerPallet: number | null
  pallets: number | null
  palletsTouched: boolean
}

function lineSub(l: DraftLine): string {
  return [l.product_sku || 'без SKU', l.color_name, l.size_name].filter(Boolean).join(' · ')
}

export function DispatchFormScreen({ docId }: { docId?: string } = {}) {
  const { back } = useNav()
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
  const [loadingDoc, setLoadingDoc] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const uidSeq = useRef(0)
  const initialServerIds = useRef<Set<string>>(new Set())
  // Черновик, созданный при первом нажатии «В ожидание рейса». Если создание прошло, а
  // advance упал на гейте, повторное нажатие НЕ плодит новый документ — переиспользуем id.
  // Любая правка формы сбрасывает ссылку (см. эффект ниже), чтобы не отгрузить устаревший черновик.
  const createdIdRef = useRef<string | null>(null)

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
            ready: d.cargo_type === 'defect' ? 0 : ((p?.ready_good ?? 0) + (p?.packed_good ?? 0)),
            onHand: d.cargo_type === 'defect' ? (p?.storage_defect ?? 0) : (p?.storage_good ?? 0),
            inTransit: d.cargo_type === 'defect' ? 0 : (p?.in_transit ?? 0),
            sku_pending: !!p?.sku_pending,
            itemsPerPallet: l.items_per_pallet ?? p?.items_per_pallet ?? null,
            pallets: l.pallets_qty,
            palletsTouched: false,
            site_url: l.site_url,
            store_id: l.store_id,
            store_name: l.store_name,
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
  const totalPallets = lines.reduce((s, l) => s + (l.pallets ?? 0), 0)
  // Источник отгрузки совпадает с бэк-гейтом: годный отгружается только из «Готов к
  // отгрузке» (ready), брак — со склада (storage_defect = onHand), минус остаток, уже
  // обещанный другим незакрытым отгрузкам (резерв). Склад/в пути/зарезервированное
  // можно сохранить черновиком, но не передать в рейс.
  const reservedFor = (l: DraftLine) => reservedMap[l._key] ?? 0
  const srcAvail = (l: DraftLine) => Math.max(0, (isDefect ? l.onHand : l.ready) - reservedFor(l))
  const allReady = lines.every((l) => l.qty <= srcAvail(l))
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
  if (!allReady) blockReasons.push(
    isDefect
      ? 'Часть брака недоступна (на складе или в резерве у других отгрузок) — уменьшите количество'
      : 'Часть запрошенного недоступна: товар не упакован, ещё в пути или в резерве у других отгрузок — отгрузить можно только свободный упакованный остаток, сохраните черновик',
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
        ready: cargoType === 'defect' ? 0 : b.ready_good + (b.packed_good ?? 0),
        onHand: cargoType === 'defect' ? b.storage_defect : b.storage_good,
        inTransit: cargoType === 'defect' ? 0 : b.in_transit,
        sku_pending: !!b.sku_pending,
        itemsPerPallet: b.items_per_pallet,
        pallets: recommendedPallets(qty, b.items_per_pallet),
        palletsTouched: false,
        site_url: null as string | null,
        store_id: null as string | null,
        store_name: null as string | null,
      })),
    ])
    setShowPicker(false)
  }, [cargoType])

  function setQty(uid: string, qty: number) {
    setLines((ls) => ls.map((l) => {
      if (l._uid !== uid) return l
      const nextQty = Math.max(1, Math.floor(qty))
      const pallets = l.palletsTouched ? l.pallets : (recommendedPallets(nextQty, l.itemsPerPallet) ?? l.pallets)
      return { ...l, qty: nextQty, pallets }
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
  function applySku(line: DraftLine, skuBase: string) {
    setLines((ls) => ls.map((l) => (l.product_id === line.product_id ? { ...l, sku_pending: false, product_sku: skuBase } : l)))
    setSkuLine(null)
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
      site_url: l.site_url ?? null,
      store_id: l.store_id ?? null,
      store_name: l.store_name ?? null,
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
          site_url: l.site_url ?? null,
          store_id: l.store_id ?? null,
          store_name: l.store_name ?? null,
        })
      } else {
        await addDispatchLine(id, lineToIn(l))
      }
    }
    for (const oldId of initialServerIds.current) {
      if (!present.has(oldId)) await deleteDispatchLine(id, oldId)
    }
  }

  async function save(advance: boolean) {
    if (saving) return
    if (advance && blockReasons.length > 0) { setError(blockReasons[0]); return }
    if (!clientId || lines.length === 0) { setError('Выберите клиента и добавьте позиции'); return }
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
            const overCap = l.qty > l.ready + l.onHand + l.inTransit
            const waiting = !overCap && l.qty > freeQ
            return (
              <div key={l._uid} className="formline">
                <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                    <div className="tile-meta">{lineSub(l)}</div>
                    <div className="tile-meta">
                      {`свободно ${freeQ}`}
                      {reserved > 0 ? ` · ${isDefect ? 'брак' : 'упаковано'} ${isDefect ? l.onHand : l.ready}, в резерве ${reserved}` : ''}
                      {!isDefect && l.onHand > 0 ? ` · склад ${l.onHand}` : ''}
                      {!isDefect && l.inTransit > 0 && <> · <span className="hint-warn">в пути {l.inTransit}</span></>}
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
                    {l.itemsPerPallet
                      ? `палеты · реком. ${recommendedPallets(l.qty, l.itemsPerPallet)} (${l.itemsPerPallet}/пал)`
                      : 'палеты · кратность не задана'}
                  </div>
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
          <button className="btn ghost" style={{ flex: 1 }} disabled={saving || !clientId || lines.length === 0} onClick={() => void save(false)}>
            {editing ? 'Сохранить' : 'Черновик'}
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving || blockReasons.length > 0} onClick={() => void save(true)}>
            {saving ? '…' : 'В ожидание рейса'}
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
    </div>
  )
}
