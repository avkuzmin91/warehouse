import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { createDispatch, advanceDispatch, type DispatchLineIn, type DispatchCargoType } from '../../api/dispatchApi'
import { getClients, getClientStores, type DictionaryItem, type ClientStoreItem } from '../../api/lookupsApi'
import type { PlannableItem } from '../../api/balancesApi'
import { balanceKey } from '../../utils/balanceKey'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { DateField } from '../../components/DateField'
import { Icon } from '../../components/Icon'
import { BalancePickerSheet } from './BalancePickerSheet'
import { AssignSkuSheet } from './AssignSkuSheet'

type DraftLine = DispatchLineIn & {
  _uid: string
  _key: string
  ready: number
  onHand: number
  inTransit: number
  sku_pending: boolean
}

function lineSub(l: DraftLine): string {
  return [l.product_sku || 'без SKU', l.color_name, l.size_name].filter(Boolean).join(' · ')
}

export function DispatchFormScreen() {
  const { back } = useNav()
  const [cargoType, setCargoType] = useState<DispatchCargoType>('good')
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [clientId, setClientId] = useState('')
  const [clientName, setClientName] = useState<string | null>(null)
  const [stores, setStores] = useState<ClientStoreItem[]>([])
  const [shipDate, setShipDate] = useState('')
  const [logisticsCost, setLogisticsCost] = useState('')
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
  const allOnStock = lines.every((l) => l.qty <= l.ready + l.onHand)
  const costNum = Number(logisticsCost)
  const costFilled = logisticsCost.trim() !== '' && Number.isFinite(costNum) && costNum >= 0

  const blockReasons: string[] = []
  if (!clientId) blockReasons.push('Выберите клиента')
  if (!shipDate) blockReasons.push('Укажите дату отгрузки')
  if (!costFilled) blockReasons.push('Укажите стоимость логистики')
  if (comment.trim() === '') blockReasons.push('Заполните техническое задание')
  if (lines.length === 0) blockReasons.push('Добавьте хотя бы одну позицию')
  if (lines.some((l) => l.sku_pending)) blockReasons.push('Укажите SKU для товаров без артикула')
  if (!allOnStock) blockReasons.push('Часть товара ещё в пути — сохраните черновик и передайте в рейс после прихода')

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
        product_id: b.product_id,
        product_name: b.product_name,
        product_sku: b.product_sku,
        color_id: b.color_id,
        color_name: b.color_name,
        size_id: b.size_id,
        size_name: b.size_name,
        qty,
        ready: cargoType === 'defect' ? 0 : b.ready_good,
        onHand: cargoType === 'defect' ? b.storage_defect : b.storage_good,
        inTransit: cargoType === 'defect' ? 0 : b.in_transit,
        sku_pending: !!b.sku_pending,
        site_url: null as string | null,
        store_id: null as string | null,
        store_name: null as string | null,
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
  function setSiteUrl(uid: string, url: string) {
    setLines((ls) => ls.map((l) => (l._uid === uid ? { ...l, site_url: url || null } : l)))
  }
  function applySku(line: DraftLine, skuBase: string) {
    setLines((ls) => ls.map((l) => (l.product_id === line.product_id ? { ...l, sku_pending: false, product_sku: skuBase } : l)))
    setSkuLine(null)
  }

  async function save(advance: boolean) {
    if (saving) return
    if (advance && blockReasons.length > 0) { setError(blockReasons[0]); return }
    if (!clientId || lines.length === 0) { setError('Выберите клиента и добавьте позиции'); return }
    setError('')
    setSaving(true)
    try {
      const res = await createDispatch({
        cargo_type: cargoType,
        client_id: clientId,
        client_name: clientName,
        ship_date: shipDate || null,
        logistics_cost: costFilled ? costNum : null,
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
          site_url: l.site_url ?? null,
          store_id: l.store_id ?? null,
          store_name: l.store_name ?? null,
        })),
      })
      if (advance) await advanceDispatch(res.message)
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      setSaving(false)
    }
  }

  const storeOptions = stores.map((s) => ({ value: s.id, label: s.name }))

  return (
    <div className="screen">
      <AppBar title="Новая отгрузка" sub="Номер присвоится при сохранении" onBack={back} noProfile />
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
          <textarea
            className="input"
            rows={3}
            placeholder="Опишите задачу для команды склада"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ resize: 'vertical', minHeight: 76 }}
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
            const overCap = l.qty > l.ready + l.onHand + l.inTransit
            const waiting = !overCap && l.qty > l.ready + l.onHand
            return (
              <div key={l._uid} className="formline">
                <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                    <div className="tile-meta">{lineSub(l)}</div>
                    <div className="tile-meta">
                      {isDefect
                        ? `брак ${l.onHand}`
                        : `упаковано ${l.ready}${l.onHand > 0 ? ` · склад ${l.onHand}` : ''}`}
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
