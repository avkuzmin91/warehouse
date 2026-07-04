import { useCallback, useEffect, useRef, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import { newRequestId } from '../../api/http'
import {
  createExpense,
  expensePaymentTone,
  getExpenseDict,
  getExpenses,
  uploadExpenseFile,
  type ExpenseDictItem,
} from '../../api/expensesApi'
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

const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'Все' },
  { key: 'awaiting', label: 'Ожидают' },
  { key: 'paid', label: 'Оплачены' },
]

// «Расходы»: менеджеру бэк отдаёт хозрасходы и логистику (аренда/ЗП — admin-only).
export function ExpensesScreen() {
  const { back, openExpenseDoc } = useNav()
  const [filter, setFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const fetchPage = useCallback(
    (page: number, limit: number, signal?: AbortSignal) =>
      getExpenses({ page, limit, payment_status: filter || undefined }, signal),
    [filter],
  )
  const { items, total, loading, loadingMore, error, refresh, loadMore, hasMore } = usePagedList(fetchPage)

  return (
    <div className="screen">
      <AppBar title="Расходы" sub="Хозрасходы и логистика" onBack={back} />
      <PullToRefresh className="scroll pad-nav" onRefresh={refresh}>
        <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={16} /> Новый расход
        </button>

        <div className="tabs" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`tab${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading ? (
          <div className="center"><div className="spin" /><div>Загрузка…</div></div>
        ) : items.length === 0 ? (
          <div className="center">
            <div className="center-ico"><Icon name="chart" size={26} /></div>
            <div>Нет расходов</div>
          </div>
        ) : (
          <>
            <div className="sec">Расходы<span className="sec-count">{total}</span></div>
            {items.map((e) => {
              const tone = expensePaymentTone(e.payment_status)
              return (
                <button key={e.id} className="tile" onClick={() => openExpenseDoc(e.id)}>
                  <div className="tile-ico"><Icon name="chart" size={21} /></div>
                  <div className="tile-body">
                    <div className="tile-title">{e.name} · {formatMoneyKopecks(e.amount)}</div>
                    <div className="tile-meta">
                      {fmtDate(e.spent_on)}
                      {e.category_name ? ` · ${e.category_name}` : ''}
                      {e.kind !== 'manual' ? ` · ${e.kind_label}` : ''}
                      {e.file_count > 0 ? ` · 📎${e.file_count}` : ''}
                    </div>
                  </div>
                  {tone && (
                    <span className={`badge ${tone}`}>
                      <span className="dot" />
                      {e.payment_status_label}
                    </span>
                  )}
                  <span className="tile-chev"><Icon name="chev" size={18} /></span>
                </button>
              )
            })}
            <LoadMore shown={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onMore={loadMore} />
          </>
        )}
      </PullToRefresh>

      {createOpen && (
        <ExpenseCreateSheet
          onClose={() => setCreateOpen(false)}
          onDone={() => {
            setCreateOpen(false)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

// Создание хозрасхода: категория/название/кол-во/ед./сумма + статус оплаты; фото чека
// прикладываются после создания (create возвращает id расхода).
function ExpenseCreateSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [categories, setCategories] = useState<ExpenseDictItem[]>([])
  const [sources, setSources] = useState<ExpenseDictItem[]>([])
  const [spentOn, setSpentOn] = useState(moscowTodayYmd())
  const [categoryId, setCategoryId] = useState('')
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('шт')
  const [amount, setAmount] = useState('')
  const [paid, setPaid] = useState(true)
  const [sourceId, setSourceId] = useState('')
  const [supplier, setSupplier] = useState('')
  const [comment, setComment] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [requestId] = useState(newRequestId)
  // После успешного create ретрай не должен создавать второй расход — только дозагрузить файлы.
  const createdIdRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    Promise.all([getExpenseDict('categories', ac.signal), getExpenseDict('payment-sources', ac.signal)])
      .then(([cat, src]) => {
        if (ac.signal.aborted) return
        setCategories(cat)
        setSources(src)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  const kop = parseRublesToKopecks(amount)
  const valid =
    spentOn && categoryId && name.trim() && unit.trim() && kop != null && kop > 0 && (!paid || sourceId)

  function addFiles(list: FileList | null) {
    if (!list) return
    setFiles((prev) => [...prev, ...Array.from(list)])
  }

  async function submit() {
    if (saving || !valid) return
    setSaving(true)
    setError('')
    try {
      if (!createdIdRef.current) {
        const res = await createExpense(
          {
            spent_on: spentOn,
            category_id: categoryId,
            name: name.trim(),
            quantity: Math.max(0, Number(quantity.replace(',', '.')) || 1),
            unit: unit.trim(),
            amount: kop as number,
            payment_source_id: paid ? sourceId : null,
            supplier: supplier.trim() || null,
            comment: comment.trim() || null,
            kind: 'manual',
            payment_status: paid ? 'paid' : 'awaiting',
          },
          requestId,
        )
        createdIdRef.current = res.message
      }
      for (const f of files) {
        await uploadExpenseFile(createdIdRef.current, f)
      }
      onDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось создать расход'
      setError(createdIdRef.current ? `Расход создан, но файл не загрузился: ${msg}` : msg)
      setSaving(false)
    }
  }

  useHardwareBack(() => { if (!saving) onClose() })

  return (
    <div className="sheet-backdrop" onClick={() => { if (!saving) onClose() }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Новый расход</h3>

        <div className="flabel">Дата</div>
        <DateField value={spentOn} onChange={setSpentOn} title="Дата расхода" />

        <div className="flabel" style={{ marginTop: 10 }}>Категория</div>
        <Combobox
          value={categoryId}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          placeholder="Выберите категорию"
          title="Категория"
          onChange={setCategoryId}
        />

        <div className="flabel" style={{ marginTop: 10 }}>Наименование</div>
        <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Что купили…" />

        <div className="line-row" style={{ gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="flabel" style={{ marginTop: 10 }}>Кол-во</div>
            <input className="input num" type="text" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="flabel" style={{ marginTop: 10 }}>Ед. изм.</div>
            <input className="input" type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="шт" />
          </div>
        </div>

        <div className="flabel" style={{ marginTop: 10 }}>Сумма, ₽</div>
        <input className="input num" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />

        <div className="flabel" style={{ marginTop: 10 }}>Оплата</div>
        <div className="tabs">
          <button className={`tab${paid ? ' active' : ''}`} onClick={() => setPaid(true)}>Оплачено</button>
          <button className={`tab${!paid ? ' active' : ''}`} onClick={() => setPaid(false)}>Ожидает</button>
        </div>

        {paid && (
          <>
            <div className="flabel" style={{ marginTop: 10 }}>Источник оплаты</div>
            <Combobox
              value={sourceId}
              options={sources.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Выберите источник"
              title="Источник оплаты"
              onChange={setSourceId}
            />
          </>
        )}

        <div className="flabel" style={{ marginTop: 10 }}>Поставщик (не обязательно)</div>
        <input className="input" type="text" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="—" />

        <div className="flabel" style={{ marginTop: 10 }}>Комментарий</div>
        <TextArea value={comment} onChange={setComment} placeholder="Комментарий…" minRows={2} />

        <div className="flabel" style={{ marginTop: 10 }}>Чек / фото</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
        />
        <button className="btn ghost sm auto" onClick={() => fileInputRef.current?.click()}>
          <Icon name="upload" size={14} /> Прикрепить файл
        </button>
        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} style={{ display: 'inline-flex', gap: 2 }}>
                <span className="badge">{f.name}</span>
                <button
                  className="btn ghost sm auto"
                  aria-label={`Убрать файл ${f.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

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
