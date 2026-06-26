import { useCallback, useEffect, useState } from 'react'
import {
  createRecurringTemplate,
  deleteRecurringRate,
  deleteRecurringTemplate,
  getRecurringTemplate,
  setRecurringRate,
  updateRecurringTemplate,
} from '../../../../api/recurringExpensesApi'
import type {
  RecurringFrequency,
  RecurringRateEntry,
  RecurringTemplateDetail,
} from '../../../../api/recurringExpensesApi'
import type { ExpenseDictItem } from '../../../../api/expensesApi'
import { Drawer } from '../../../feedback/Drawer'
import { Icon } from '../../../primitives/Icon'
import { Combobox } from '../../../data/Combobox'
import { DatePicker } from '../../../primitives/DatePicker'
import { useToast } from '../../../feedback/Toast'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { fmtDate, formatMoneyKopecks, moscowTodayYmd, parseRublesToKopecks } from '../../../../utils/format'

interface Props {
  templateId: string | null
  categories: ExpenseDictItem[]
  paymentSources: ExpenseDictItem[]
  onClose: () => void
  onSaved: () => void
}

const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1)

export function RecurringExpenseDrawer({ templateId, categories, paymentSources, onClose, onSaved }: Props) {
  const toast = useToast()
  const confirm = useConfirm()
  const isNew = templateId === null

  const [detail, setDetail] = useState<RecurringTemplateDetail | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)

  // Параметры шаблона
  const [name, setName] = useState('')
  const [frequency, setFrequency] = useState<RecurringFrequency>('daily')
  const [monthDay, setMonthDay] = useState(1)
  const [categoryId, setCategoryId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [supplier, setSupplier] = useState('')
  const [startDate, setStartDate] = useState(moscowTodayYmd())
  const [endDate, setEndDate] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Ставка
  const [rateRub, setRateRub] = useState('')
  const [rateFrom, setRateFrom] = useState(moscowTodayYmd())

  const fillFromDetail = useCallback((d: RecurringTemplateDetail) => {
    setDetail(d)
    setName(d.name)
    setFrequency(d.frequency)
    setMonthDay(d.month_day ?? 1)
    setCategoryId(d.category_id ?? '')
    setSourceId(d.payment_source_id ?? '')
    setSupplier(d.supplier ?? '')
    setStartDate(d.start_date)
    setEndDate(d.end_date ?? '')
    setIsActive(d.is_active)
  }, [])

  const reload = useCallback(() => {
    if (!templateId) return Promise.resolve()
    return getRecurringTemplate(templateId)
      .then(fillFromDetail)
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
  }, [templateId, fillFromDetail, toast])

  useEffect(() => {
    if (!templateId) return
    let alive = true
    setLoading(true)
    getRecurringTemplate(templateId)
      .then((d) => { if (alive) fillFromDetail(d) })
      .catch((e) => { if (alive) toast(e instanceof Error ? e.message : String(e), 'error') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [templateId, fillFromDetail, toast])

  function basePayload() {
    return {
      name: name.trim(),
      frequency,
      month_day: frequency === 'monthly' ? monthDay : null,
      category_id: categoryId || null,
      payment_source_id: sourceId || null,
      supplier: supplier.trim() || null,
      start_date: startDate,
      end_date: endDate || null,
      is_active: isActive,
    }
  }

  function validate(): string | null {
    if (!name.trim()) return 'Укажите название'
    if (frequency === 'monthly' && (!monthDay || monthDay < 1 || monthDay > 28)) return 'Число месяца: 1–28'
    if (endDate && endDate < startDate) return 'Дата окончания раньше начала'
    return null
  }

  function saveNew() {
    const err = validate()
    if (err) { toast(err, 'error'); return }
    const kop = rateRub.trim() ? parseRublesToKopecks(rateRub) : null
    if (rateRub.trim() && (kop == null || kop <= 0)) { toast('Стоимость — число больше нуля', 'error'); return }
    setSaving(true)
    createRecurringTemplate({ ...basePayload(), amount_kop: kop ?? undefined })
      .then(() => { toast('Регулярный расход создан', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setSaving(false))
  }

  function saveBasics() {
    if (!templateId) return
    const err = validate()
    if (err) { toast(err, 'error'); return }
    setSaving(true)
    updateRecurringTemplate(templateId, basePayload())
      .then(() => { toast('Изменения сохранены', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setSaving(false))
  }

  function addRate() {
    if (!templateId) return
    const kop = parseRublesToKopecks(rateRub)
    if (kop == null || kop <= 0) { toast('Укажите стоимость', 'error'); return }
    setSaving(true)
    setRecurringRate(templateId, { amount_kop: kop, effective_from: rateFrom })
      .then(() => { toast('Ставка добавлена', 'success'); setRateRub(''); return reload() })
      .then(() => onSaved())
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setSaving(false))
  }

  const deleteRate = useCallback(async (entry: RecurringRateEntry) => {
    if (!templateId) return
    const ok = await confirm({
      title: 'Удалить запись ставки?',
      body: `Запись «${formatMoneyKopecks(entry.amount_kop)} с ${fmtDate(entry.effective_from)}» перестанет учитываться. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    try {
      await deleteRecurringRate(templateId, entry.id)
      toast('Запись удалена', 'success')
      await reload()
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }, [templateId, confirm, reload, onSaved, toast])

  async function removeTemplate() {
    if (!templateId) return
    const ok = await confirm({
      title: 'Удалить регулярный расход?',
      body: `«${name}» перестанет начисляться. Уже заведённые расходы останутся. Это действие нельзя отменить.`,
      danger: true,
      confirmLabel: 'Удалить',
    })
    if (!ok) return
    try {
      await deleteRecurringTemplate(templateId)
      toast('Регулярный расход удалён', 'success')
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isNew ? 'Новый регулярный расход' : (detail?.name ?? 'Регулярный расход')}
      subtitle="Начисляется автоматически по расписанию"
      width={540}
      footer={
        <>
          {!isNew && (
            <button className="btn ghost" style={{ color: 'var(--c-danger)', marginRight: 'auto' }} onClick={removeTemplate}>
              <Icon name="trash" size={14} />Удалить
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={isNew ? saveNew : saveBasics} disabled={saving || loading}>
            <Icon name="check" size={14} />{isNew ? 'Создать' : 'Сохранить'}
          </button>
        </>
      }
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
          <div style={{ width: 22, height: 22, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Название">
            <input className="input sm" placeholder="напр. Аренда погрузчика" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: frequency === 'monthly' ? '1fr 1fr' : '1fr', gap: 14 }}>
            <Field label="Периодичность">
              <select className="input sm" value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}>
                <option value="daily">Ежедневно</option>
                <option value="monthly">Ежемесячно</option>
              </select>
            </Field>
            {frequency === 'monthly' && (
              <Field label="Число месяца">
                <select className="input sm" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))}>
                  {MONTH_DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Категория">
              <Combobox
                value={categoryId || null}
                onChange={(v) => setCategoryId(v ? String(v) : '')}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="Без категории"
                prefix="tag"
              />
            </Field>
            <Field label="Источник оплаты">
              <Combobox
                value={sourceId || null}
                onChange={(v) => setSourceId(v ? String(v) : '')}
                options={paymentSources.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Не указан"
                prefix="wallet"
              />
            </Field>
          </div>

          <Field label="Поставщик (необязательно)">
            <input className="input sm" placeholder="напр. ИП Иванов" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Действует с">
              <DatePicker value={startDate} onChange={setStartDate} />
            </Field>
            <Field label="По (необязательно)">
              <DatePicker value={endDate} onChange={setEndDate} />
            </Field>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Активен (начисляется по расписанию)
          </label>

          {/* Ставка */}
          <div style={{ marginTop: 6, paddingTop: 14, borderTop: '1px solid var(--c-border)' }}>
            {!isNew && (
              <div className="card" style={{ padding: '10px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>Стоимость сейчас</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: detail?.current_amount_kop != null ? 'var(--c-success)' : 'var(--c-text-faint)' }}>
                  {detail?.current_amount_kop != null ? formatMoneyKopecks(detail.current_amount_kop) : 'нет ставки'}
                </div>
              </div>
            )}
            <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', marginBottom: 8 }}>
              {isNew
                ? 'Стартовая стоимость (необязательно — можно задать позже). Меняется со временем добавлением новых записей.'
                : 'Новая стоимость. Действует с указанной даты; если она в прошлом — применится и к более раннему.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isNew ? '1fr' : '1fr 1fr auto', gap: 10, alignItems: 'end' }}>
              <Field label="Стоимость, ₽">
                <input className="input sm" inputMode="decimal" placeholder="напр. 1500" value={rateRub} onChange={(e) => setRateRub(e.target.value)} />
              </Field>
              {!isNew && (
                <>
                  <Field label="Действует с">
                    <DatePicker value={rateFrom} onChange={setRateFrom} />
                  </Field>
                  <button className="btn sm" onClick={addRate} disabled={saving} style={{ marginBottom: 1 }}>
                    <Icon name="plus" size={13} />Добавить
                  </button>
                </>
              )}
            </div>

            {!isNew && (
              <RateHistory entries={detail?.rates ?? []} onDelete={deleteRate} />
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 5 }}>{label}</div>
      {children}
    </label>
  )
}

function RateHistory({ entries, onDelete }: { entries: RecurringRateEntry[]; onDelete: (e: RecurringRateEntry) => void }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-muted)', marginBottom: 6 }}>История стоимости</div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--c-text-faint)' }}>Записей нет</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
              <span className="mono" style={{ color: 'var(--c-text-subtle)', minWidth: 92 }}>с {fmtDate(e.effective_from)}</span>
              <span style={{ fontWeight: 600 }}>{formatMoneyKopecks(e.amount_kop)}</span>
              <button
                className="btn ghost icon sm"
                style={{ marginLeft: 'auto', color: 'var(--c-danger)' }}
                title="Удалить запись"
                onClick={() => onDelete(e)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
