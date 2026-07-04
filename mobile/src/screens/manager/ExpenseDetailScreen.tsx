import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  expensePaymentTone,
  getExpense,
  getExpenseDict,
  payExpense,
  type ExpenseDetail,
  type ExpenseDictItem,
} from '../../api/expensesApi'
import { AppBar } from '../../components/AppBar'
import { Combobox } from '../../components/Combobox'
import { DateField } from '../../components/DateField'
import { Icon } from '../../components/Icon'
import { LineFiles } from '../../components/LineFiles'
import { useHardwareBack } from '../../nav/backHandlers'
import { fmtDate, formatMoneyKopecks, moscowTodayYmd, parseRublesToKopecks } from '../../utils/format'

export function ExpenseDetailScreen({ expenseId }: { expenseId: string }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<ExpenseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paySheet, setPaySheet] = useState(false)

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    getExpense(expenseId, signal)
      .then((d) => { if (!signal?.aborted) setDoc(d) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить расход') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [expenseId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const payable = doc?.payment_status === 'awaiting' || doc?.payment_status === 'partially_paid'
  const remaining = doc ? Math.max(0, doc.amount - doc.paid_amount) : 0
  const tone = doc ? expensePaymentTone(doc.payment_status) : ''

  return (
    <div className="screen">
      <AppBar title={doc ? doc.exp_number : 'Расход'} sub={doc ? doc.kind_label : ''} onBack={back} noProfile />
      <div className="scroll pad-nav">
        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading || !doc ? (
          !error && <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
        ) : (
          <>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv"><span className="k">Наименование</span><span className="v">{doc.name}</span></div>
              <div className="kv"><span className="k">Статус</span>
                <span className="v">
                  {tone
                    ? <span className={`badge ${tone}`}><span className="dot" />{doc.payment_status_label}</span>
                    : doc.payment_status_label}
                </span>
              </div>
              <div className="kv"><span className="k">Дата</span><span className="v">{fmtDate(doc.spent_on)}</span></div>
              {doc.category_name && (<div className="kv"><span className="k">Категория</span><span className="v">{doc.category_name}</span></div>)}
              <div className="kv"><span className="k">Сумма</span><span className="v mono">{formatMoneyKopecks(doc.amount)}</span></div>
              {doc.paid_amount > 0 && doc.paid_amount < doc.amount && (
                <div className="kv"><span className="k">Оплачено</span><span className="v mono">{formatMoneyKopecks(doc.paid_amount)}</span></div>
              )}
              {doc.quantity !== 1 && (
                <div className="kv"><span className="k">Кол-во</span><span className="v">{doc.quantity}{doc.unit ? ` ${doc.unit}` : ''}</span></div>
              )}
              {doc.carrier_name && (<div className="kv"><span className="k">Перевозчик</span><span className="v">{doc.carrier_name}</span></div>)}
              {doc.supplier && (<div className="kv"><span className="k">Поставщик</span><span className="v">{doc.supplier}</span></div>)}
              {doc.payment_source_name && (<div className="kv"><span className="k">Источник</span><span className="v">{doc.payment_source_name}</span></div>)}
              {doc.comment && (<div className="kv"><span className="k">Комментарий</span><span className="v">{doc.comment}</span></div>)}
            </div>

            {payable && (
              <button className="btn" style={{ marginBottom: 16 }} onClick={() => setPaySheet(true)}>
                <Icon name="check" size={15} /> Оплатить
              </button>
            )}

            {doc.files.length > 0 && (
              <>
                <div className="sec">Вложения<span className="sec-count">{doc.files.length}</span></div>
                <div className="line" style={{ padding: '8px 14px' }}>
                  <LineFiles files={doc.files} onError={setError} />
                </div>
              </>
            )}

            {doc.payments.length > 0 && (
              <>
                <div className="sec" style={{ marginTop: 16 }}>Платежи<span className="sec-count">{doc.payments.length}</span></div>
                <div className="line" style={{ padding: '2px 14px' }}>
                  {doc.payments.map((p) => (
                    <div key={p.id} className="oprow">
                      <div className="oprow-t">{formatMoneyKopecks(p.amount)}{p.payment_source_name ? ` · ${p.payment_source_name}` : ''}</div>
                      <div className="oprow-m">{fmtDate(p.paid_on)}{p.created_by_email ? ` · ${p.created_by_email}` : ''}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {paySheet && doc && (
        <ExpensePaySheet
          remainingKop={remaining}
          onClose={() => setPaySheet(false)}
          onSave={async (payload) => {
            await payExpense(doc.id, payload)
            setPaySheet(false)
            load()
          }}
        />
      )}
    </div>
  )
}

// Оплата расхода: источник обязателен; сумма по умолчанию — весь остаток (полная оплата).
function ExpensePaySheet({
  remainingKop,
  onClose,
  onSave,
}: {
  remainingKop: number
  onClose: () => void
  onSave: (payload: { paid_on?: string | null; payment_source_id?: string | null; amount?: number | null }) => Promise<void>
}) {
  const [sources, setSources] = useState<ExpenseDictItem[]>([])
  const [sourceId, setSourceId] = useState('')
  const [amount, setAmount] = useState(remainingKop > 0 ? String(remainingKop / 100).replace('.', ',') : '')
  const [paidOn, setPaidOn] = useState(moscowTodayYmd())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const ac = new AbortController()
    getExpenseDict('payment-sources', ac.signal)
      .then((s) => { if (!ac.signal.aborted) setSources(s) })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  const kop = parseRublesToKopecks(amount)
  const valid = sourceId && kop != null && kop > 0

  async function submit() {
    if (saving || !valid) return
    setSaving(true)
    setError('')
    try {
      // Полная оплата — без amount (бэк гасит остаток целиком), частичная — с суммой.
      await onSave({
        paid_on: paidOn || null,
        payment_source_id: sourceId,
        amount: kop === remainingKop ? null : kop,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось оплатить расход')
      setSaving(false)
    }
  }

  useHardwareBack(() => { if (!saving) onClose() })

  return (
    <div className="sheet-backdrop" onClick={() => { if (!saving) onClose() }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Оплата расхода</h3>

        <div className="flabel">Источник оплаты</div>
        <Combobox
          value={sourceId}
          options={sources.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Выберите источник"
          title="Источник оплаты"
          onChange={setSourceId}
        />

        <div className="flabel" style={{ marginTop: 10 }}>Сумма, ₽</div>
        <input
          className="input num"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
        />
        {remainingKop > 0 && (
          <div className="line-sub" style={{ marginTop: 4 }}>Остаток: {formatMoneyKopecks(remainingKop)}</div>
        )}

        <div className="flabel" style={{ marginTop: 10 }}>Дата оплаты</div>
        <DateField value={paidOn} onChange={setPaidOn} title="Дата оплаты" />

        {error && (<div className="alert" style={{ marginTop: 10 }}><Icon name="alert" size={15} />{error}</div>)}

        <div className="dtf-actions">
          <button className="btn ghost" disabled={saving} onClick={onClose}>Отмена</button>
          <button className="btn" disabled={saving || !valid} onClick={() => void submit()}>
            {saving ? <span className="spin spin-sm" /> : 'Оплатить'}
          </button>
        </div>
      </div>
    </div>
  )
}
