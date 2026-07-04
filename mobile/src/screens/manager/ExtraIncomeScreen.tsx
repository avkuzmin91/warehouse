import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { newRequestId } from '../../api/http'
import {
  createExtraIncome,
  getExtraIncome,
  getExtraIncomeCategories,
  getExtraIncomeSummary,
  type ExtraIncomeCategory,
  type ExtraIncomeSummary,
} from '../../api/extraIncomeApi'
import { getClients, type DictionaryItem } from '../../api/lookupsApi'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { DateField } from '../../components/DateField'
import { Icon } from '../../components/Icon'
import { LoadMore } from '../../components/LoadMore'
import { PullToRefresh } from '../../components/PullToRefresh'
import { TextArea } from '../../components/TextArea'
import { useHardwareBack } from '../../nav/backHandlers'
import { fmtDate, formatMoneyKopecks, moscowTodayYmd, parseRublesToKopecks } from '../../utils/format'
import { usePagedList } from '../../hooks/usePagedList'

// «Доп. работы»: ручной доход (монтаж, маркировка и т.п.) — попадает в счёт и P&L.
export function ExtraIncomeScreen() {
  const { back } = useNav()
  const [summary, setSummary] = useState<ExtraIncomeSummary | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const fetchPage = useCallback(
    (page: number, limit: number, signal?: AbortSignal) => getExtraIncome({ page, limit }, signal),
    [],
  )
  const { items, total, loading, loadingMore, error, refresh, loadMore, hasMore } = usePagedList(fetchPage)

  const loadSummary = useCallback((signal?: AbortSignal) => {
    getExtraIncomeSummary(signal)
      .then((s) => { if (!signal?.aborted) setSummary(s) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    loadSummary(ac.signal)
    return () => ac.abort()
  }, [loadSummary])

  return (
    <div className="screen">
      <AppBar title="Доп. работы" sub="Финансы" onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => Promise.all([refresh(), loadSummary()]).then(() => undefined)}>
        <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={16} /> Новая работа
        </button>

        {summary && (
          <div className="summary" style={{ marginBottom: 12 }}>
            <div className="kv"><span className="k">Всего</span><span className="v mono">{formatMoneyKopecks(summary.total_amount)}</span></div>
            <div className="kv"><span className="k">Без счёта</span>
              <span className="v mono">{formatMoneyKopecks(summary.uninvoiced_amount)}{summary.uninvoiced_count > 0 ? ` · ${summary.uninvoiced_count}` : ''}</span>
            </div>
          </div>
        )}

        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading ? (
          <div className="center"><div className="spin" /><div>Загрузка…</div></div>
        ) : items.length === 0 ? (
          <div className="center">
            <div className="center-ico"><Icon name="star" size={26} /></div>
            <div>Нет доп. работ</div>
          </div>
        ) : (
          <>
            <div className="sec">Записи<span className="sec-count">{total}</span></div>
            <div className="line" style={{ padding: '2px 14px' }}>
              {items.map((e) => (
                <div key={e.id} className="oprow">
                  <div className="oprow-t">
                    {e.category_name ?? 'Доп. работа'}{e.client_name ? ` · ${e.client_name}` : ''} · {formatMoneyKopecks(e.amount_kop)}
                  </div>
                  <div className="oprow-m">
                    {fmtDate(e.entry_date)}
                    {e.qty != null ? ` · ${e.qty} шт${e.qty > 0 ? ` ≈ ${formatMoneyKopecks(Math.round(e.amount_kop / e.qty))}/шт` : ''}` : ''}
                    {e.invoice_number ? ` · счёт ${e.invoice_number}` : ' · без счёта'}
                  </div>
                </div>
              ))}
            </div>
            <LoadMore shown={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onMore={loadMore} />
          </>
        )}
      </PullToRefresh>

      {createOpen && (
        <ExtraIncomeCreateSheet
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false)
            void refresh()
            loadSummary()
          }}
        />
      )}
    </div>
  )
}

function ExtraIncomeCreateSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [categories, setCategories] = useState<ExtraIncomeCategory[]>([])
  const [entryDate, setEntryDate] = useState(moscowTodayYmd())
  const [clientId, setClientId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [qty, setQty] = useState('')
  const [amount, setAmount] = useState('')
  // Хранится всегда итог (amount_kop); «за единицу» — только режим ввода на форме.
  const [perUnit, setPerUnit] = useState(false)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // requestId фиксируется на время жизни шторки: ретрай после обрыва не задваивает запись.
  const [requestId] = useState(newRequestId)

  useEffect(() => {
    const ac = new AbortController()
    Promise.all([getClients(ac.signal), getExtraIncomeCategories(ac.signal)])
      .then(([cl, cat]) => {
        if (ac.signal.aborted) return
        setClients(cl.filter((c) => c.is_active !== false && !c.is_deleted))
        setCategories(cat)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  const kop = parseRublesToKopecks(amount)
  const qtyNum = qty.trim() === '' ? null : Math.max(0, Math.floor(Number(qty) || 0))
  const qtyValid = qtyNum != null && qtyNum > 0
  const totalKop = perUnit ? (kop != null && qtyValid ? kop * qtyNum : null) : kop
  const valid = entryDate && clientId && categoryId && totalKop != null && totalKop > 0

  async function submit() {
    if (saving || !valid) return
    setSaving(true)
    setError('')
    try {
      await createExtraIncome(
        {
          entry_date: entryDate,
          client_id: clientId,
          category_id: categoryId,
          qty: qtyNum,
          amount_kop: totalKop as number,
          comment: comment.trim() || null,
        },
        requestId,
      )
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать запись')
      setSaving(false)
    }
  }

  useHardwareBack(() => { if (!saving) onClose() })

  return (
    <div className="sheet-backdrop" onClick={() => { if (!saving) onClose() }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Новая доп. работа</h3>

        <div className="flabel">Дата</div>
        <DateField value={entryDate} onChange={setEntryDate} title="Дата работы" />

        <div className="flabel" style={{ marginTop: 10 }}>Клиент</div>
        <Combobox
          value={clientId}
          options={clients.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Выберите клиента"
          title="Клиент"
          onChange={setClientId}
        />

        <div className="flabel" style={{ marginTop: 10 }}>Вид работы</div>
        <Combobox
          value={categoryId}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Выберите вид работы"
          title="Вид работы"
          onChange={setCategoryId}
        />

        <div className="flabel" style={{ marginTop: 10 }}>Количество, шт (не обязательно)</div>
        <input
          className="input num"
          type="text"
          inputMode="numeric"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value)
            if (!e.target.value.trim()) setPerUnit(false)
          }}
          placeholder="—"
        />

        <div className="flabel" style={{ marginTop: 10 }}>{perUnit ? 'Цена за шт., ₽' : 'Сумма итого, ₽'}</div>
        <div className="seg" style={{ marginBottom: 8 }}>
          <button type="button" className={!perUnit ? 'active' : ''} onClick={() => setPerUnit(false)}>Итого</button>
          <button type="button" className={perUnit ? 'active' : ''} disabled={!qtyValid}
            style={!qtyValid ? { opacity: 0.45 } : undefined}
            onClick={() => { if (qtyValid) setPerUnit(true) }}>За единицу</button>
        </div>
        <input
          className="input num"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
        />
        {qtyValid && kop != null && kop > 0 && (
          <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
            {perUnit
              ? <>{qtyNum} шт × {formatMoneyKopecks(kop)} = <b>{formatMoneyKopecks(totalKop)}</b> итого</>
              : <>{formatMoneyKopecks(kop)} ÷ {qtyNum} шт ≈ <b>{formatMoneyKopecks(Math.round(kop / qtyNum))}</b>/шт</>}
          </div>
        )}

        <div className="flabel" style={{ marginTop: 10 }}>Комментарий</div>
        <TextArea value={comment} onChange={setComment} placeholder="Что сделали…" minRows={2} />

        {error && (<div className="alert" style={{ marginTop: 10 }}><Icon name="alert" size={15} />{error}</div>)}

        <div className="dtf-actions">
          <button className="btn ghost" disabled={saving} onClick={onClose}>Отмена</button>
          <button className="btn" disabled={saving || !valid} onClick={() => void submit()}>
            {saving ? <span className="spin spin-sm" /> : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
