import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { createReceipt, advanceReceiptStatus, type ReceiptLineInput } from '../../api/receiptsApi'
import { getClients, type DictionaryItem, type ProductLookup } from '../../api/lookupsApi'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { DateField } from '../../components/DateField'
import { Icon } from '../../components/Icon'
import { MatrixEntrySheet, type MatrixCell } from './MatrixEntrySheet'

type DraftLine = ReceiptLineInput & { _id: number }

function lineVariantKey(l: DraftLine): string {
  return [l.product_id, l.color_id ?? '', l.size_id ?? ''].join('|')
}

function lineSub(l: DraftLine): string {
  return [l.product_sku || 'без SKU', l.color_name, l.size_name].filter(Boolean).join(' · ')
}

export function ReceiptFormScreen() {
  const { back } = useNav()
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [clientId, setClientId] = useState('')
  const [arrivalDate, setArrivalDate] = useState('')
  const [logisticsCost, setLogisticsCost] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const idRef = useRef(1)

  useEffect(() => {
    const ac = new AbortController()
    getClients(ac.signal)
      .then((res) => { if (!ac.signal.aborted) setClients(res.filter((c) => c.is_active !== false && !c.is_deleted)) })
      .catch(() => { /* aborted */ })
    return () => ac.abort()
  }, [])

  const totalQty = lines.reduce((s, l) => s + l.planned_qty, 0)
  const totalSku = new Set(lines.map((l) => l.product_sku)).size

  const blockReasons: string[] = []
  if (!clientId) blockReasons.push('Не выбран клиент')
  if (!arrivalDate) blockReasons.push('Не указана дата прибытия')
  if (lines.length === 0) blockReasons.push('Не добавлено ни одной строки')
  if (lines.some((l) => l.planned_qty < 1)) blockReasons.push('Есть строки с количеством меньше 1')

  function setQty(id: number, qty: number) {
    setLines((ls) => ls.map((l) => (l._id === id ? { ...l, planned_qty: Math.max(0, Math.floor(qty)) } : l)))
  }
  function removeLine(id: number) {
    setLines((ls) => ls.filter((l) => l._id !== id))
  }

  const addCells = useCallback((product: ProductLookup, cells: MatrixCell[]) => {
    setLines((ls) => [
      ...ls,
      ...cells.map((c) => ({
        _id: idRef.current++,
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku || '',
        color_id: c.color_id,
        color_name: c.color_name,
        size_id: c.size_id,
        size_name: c.size_name,
        planned_qty: c.qty,
      })),
    ])
    setShowAdd(false)
  }, [])

  async function save() {
    if (saving) return
    if (blockReasons.length > 0) { setError(blockReasons[0]); return }
    setError('')
    setSaving(true)
    try {
      const costNum = Number(logisticsCost)
      const res = await createReceipt({
        client_id: clientId,
        arrival_date: arrivalDate || null,
        comment: comment.trim() || null,
        logistics_cost: logisticsCost.trim() !== '' && Number.isFinite(costNum) ? costNum : null,
        lines: lines.map(({ _id, ...l }) => l),
      })
      await advanceReceiptStatus(res.message)
      back()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <AppBar title="Новое поступление" sub="Номер присвоится при сохранении" onBack={back} noProfile />
      <div className="scroll pad-nav">
        <div className="field">
          <div className="flabel">Клиент <span className="req">*</span></div>
          <Combobox
            value={clientId}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Выберите клиента…"
            title="Клиент"
            onChange={(v) => { if (lines.length === 0) setClientId(v) }}
          />
          {lines.length > 0 && (
            <div className="line-sub" style={{ marginTop: 4 }}>Удалите строки, чтобы сменить клиента</div>
          )}
        </div>

        <div className="field">
          <div className="flabel">Дата прибытия (план) <span className="req">*</span></div>
          <DateField value={arrivalDate} onChange={setArrivalDate} title="Дата прибытия" />
        </div>

        <div className="field">
          <div className="flabel">Стоимость логистики для клиента, ₽</div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="0"
            value={logisticsCost}
            onChange={(e) => setLogisticsCost(e.target.value.replace(/[^\d]/g, ''))}
          />
        </div>

        <div className="field">
          <div className="flabel">Комментарий</div>
          <input
            className="input"
            type="text"
            placeholder="Примечание для склада"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <div className="sec" style={{ marginTop: 4 }}>
          Товары к приёмке
          <span className="sec-count">{lines.length}</span>
        </div>

        {lines.length === 0 ? (
          <div className="line-sub" style={{ padding: '8px 0 12px' }}>
            {clientId ? 'Нажмите «Добавить товары».' : 'Сначала выберите клиента.'}
          </div>
        ) : (
          lines.map((l) => (
            <div key={l._id} className="formline">
              <div className="line-row" style={{ marginTop: 0, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tile-title" style={{ fontSize: 14 }}>{l.product_name}</div>
                  <div className="tile-meta">{lineSub(l)}</div>
                </div>
                <button className="icon-btn danger" onClick={() => removeLine(l._id)} aria-label="Удалить">
                  <Icon name="trash" size={15} />
                </button>
              </div>

              <div className="line-row" style={{ marginTop: 8 }}>
                <input
                  className="input num"
                  inputMode="numeric"
                  value={l.planned_qty ? String(l.planned_qty) : ''}
                  placeholder="0"
                  aria-label="Количество"
                  onChange={(e) => setQty(l._id, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                />
              </div>
            </div>
          ))
        )}

        <button className="btn ghost" style={{ marginTop: 8 }} disabled={!clientId} onClick={() => setShowAdd(true)}>
          <Icon name="plus" size={15} /> Добавить товары
        </button>

        {lines.length > 0 && (
          <div className="summary" style={{ marginTop: 16 }}>
            <div className="kv"><span className="k">SKU</span><span className="v mono">{totalSku}</span></div>
            <div className="kv"><span className="k">Строк</span><span className="v mono">{lines.length}</span></div>
            <div className="kv"><span className="k">План</span><span className="v mono">{totalQty} шт</span></div>
          </div>
        )}

        {error && (
          <div className="alert" style={{ marginTop: 12 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={back} disabled={saving}>
            Отмена
          </button>
          <button className="btn" style={{ flex: 2 }} disabled={saving || blockReasons.length > 0} onClick={() => void save()}>
            {saving ? '…' : 'Запланировать'}
          </button>
        </div>
      </div>

      {showAdd && (
        <MatrixEntrySheet
          clientId={clientId}
          existingKeys={lines.map(lineVariantKey)}
          onClose={() => setShowAdd(false)}
          onSubmit={addCells}
        />
      )}
    </div>
  )
}
