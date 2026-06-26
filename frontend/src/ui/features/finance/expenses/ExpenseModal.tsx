import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  cancelExpense,
  createExpense,
  deleteExpenseFile,
  EXPENSE_KIND_LABELS,
  EXPENSE_OP_LABELS,
  EXPENSE_PAYMENT_STATUS_LABELS,
  expensePaidFraction,
  expensePaymentTone,
  getExpense,
  payExpense,
  unitPriceKopecks,
  unpayExpense,
  updateExpense,
  uploadExpenseFile,
} from '../../../../api/expensesApi'
import type { ExpenseDictItem, ExpenseKind, ExpenseOpType } from '../../../../api/expensesApi'
import { Badge } from '../../../primitives/Badge'
import { resolvePublicUploadSrc } from '../../../../api/constants'
import { Modal } from '../../../feedback/Modal'
import { Combobox } from '../../../data/Combobox'
import { DatePicker } from '../../../primitives/DatePicker'
import { Icon } from '../../../primitives/Icon'
import { useApi } from '../../../../hooks/useApi'
import { useToast } from '../../../feedback/Toast'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { fmtDateTime, formatMoneyKopecks, localTodayYmd, parseRublesToKopecks } from '../../../../utils/format'
import { FileTypeIcon } from '../financeUI'

const UNIT_SUGGESTIONS = ['шт', 'уп', 'л', 'кг', 'рулон', 'пара', 'компл', 'м']
const ALLOWED_FILES = '.pdf,.png,.jpg,.jpeg'

const OP_DOT: Record<ExpenseOpType, string> = {
  create: 'var(--c-accent)',
  update: 'var(--c-warning)',
  delete: 'var(--c-danger)',
  restore: 'var(--c-success)',
  file_add: 'var(--c-info)',
  file_delete: 'var(--c-text-muted)',
  pay: 'var(--c-success)',
  payment: 'var(--c-success)',
  unpay: 'var(--c-warning)',
  cancel: 'var(--c-text-muted)',
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)' }}>{children}</span>
      {required && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text-faint)' }}>обяз.</span>}
    </div>
  )
}

function PayStatusSeg({ active, icon, label, activeBg, activeColor, onClick }: {
  active: boolean
  icon: 'check' | 'clock'
  label: string
  activeBg: string
  activeColor: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '8px 10px', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer',
        border: '1px solid', transition: 'background .12s, color .12s, border-color .12s',
        background: active ? activeBg : 'transparent',
        color: active ? activeColor : 'var(--c-text-subtle)',
        borderColor: active ? 'transparent' : 'transparent',
        boxShadow: active ? 'var(--sh-1)' : 'none',
      }}
    >
      <Icon name={icon} size={14} />{label}
    </button>
  )
}

export type SalaryEmployee = {
  id: string
  full_name: string
  comp_type: string
  fixed_salary_kopecks: number | null
}

export function ExpenseModal({ expenseId, createKind = 'manual', categories, paymentSources, employees, onClose, onSaved, onManageDicts }: {
  expenseId: string | null
  createKind?: ExpenseKind
  categories: ExpenseDictItem[]
  paymentSources: ExpenseDictItem[]
  employees?: SalaryEmployee[]
  onClose: () => void
  onSaved: () => void
  onManageDicts: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const isEdit = !!expenseId

  const [tick, setTick] = useState(0)
  const reloadDetail = () => setTick((t) => t + 1)
  const { data: detail, loading: loadingDetail } = useApi(
    (s) => (expenseId ? getExpense(expenseId, s) : Promise.resolve(null)),
    [expenseId, tick],
  )

  const [spentOn, setSpentOn] = useState(localTodayYmd())
  const [categoryId, setCategoryId] = useState('')
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('шт')
  const [amount, setAmount] = useState('')
  const [paymentSourceId, setPaymentSourceId] = useState('')
  const [supplier, setSupplier] = useState('')
  const [comment, setComment] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'awaiting'>('paid')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [inited, setInited] = useState(false)

  const [paySourceId, setPaySourceId] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [salaryEmpId, setSalaryEmpId] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const kind: ExpenseKind = isEdit ? (detail?.kind ?? 'manual') : createKind
  // logistics приходит из рейса и правится там — в карточке только просмотр + оплата.
  const editableForm = kind === 'manual' || kind === 'rent' || kind === 'salary'
  const showQtyUnit = kind === 'manual'
  const showPeriod = kind === 'rent' || kind === 'salary'
  const isRent = kind === 'rent'
  const isSalary = kind === 'salary'
  const nameLabel = isSalary ? 'Сотрудник' : isRent ? 'Назначение' : 'Наименование'
  const useEmployeePicker = isSalary && !isEdit && (employees?.length ?? 0) > 0

  function pickEmployee(empId: string) {
    setSalaryEmpId(empId)
    const emp = employees?.find((e) => e.id === empId)
    if (!emp) return
    setName(emp.full_name)
    if (emp.comp_type === 'fixed' && emp.fixed_salary_kopecks) {
      setAmount(String(Math.round(emp.fixed_salary_kopecks / 100)))
    }
  }

  // Заполняем форму из карточки один раз после загрузки (правка).
  useEffect(() => {
    if (!detail || inited) return
    setSpentOn(detail.spent_on)
    setCategoryId(detail.category_id ?? '')
    setName(detail.name)
    setQuantity(String(detail.quantity))
    setUnit(detail.unit ?? '')
    setAmount(String(detail.amount / 100))
    setPaymentSourceId(detail.payment_source_id ?? '')
    setSupplier(detail.supplier ?? '')
    setComment(detail.comment ?? '')
    setPeriodStart(detail.period_start ?? '')
    setPeriodEnd(detail.period_end ?? '')
    setPaySourceId(detail.payment_source_id ?? '')
    setInited(true)
  }, [detail, inited])

  const kopecks = parseRublesToKopecks(amount)
  const qtyNum = showQtyUnit ? Number(quantity.replace(',', '.')) : 1
  const qtyValid = showQtyUnit ? Number.isFinite(qtyNum) && qtyNum > 0 : true
  const unitPrice = showQtyUnit && kopecks != null && qtyValid ? unitPriceKopecks(kopecks, qtyNum) : null
  const needSource = isEdit ? (detail?.payment_status === 'paid') : (paymentStatus === 'paid')

  const blockReasons: string[] = [
    ...(!spentOn ? ['Укажите дату'] : []),
    ...(kind === 'manual' && !categoryId ? ['Выберите категорию'] : []),
    ...(!name.trim() ? ['Укажите наименование'] : []),
    ...(showQtyUnit && !qtyValid ? ['Количество — число больше нуля'] : []),
    ...(showQtyUnit && !unit.trim() ? ['Укажите единицу измерения'] : []),
    ...(kopecks == null || kopecks <= 0 ? ['Сумма — число больше нуля'] : []),
    ...(needSource && !paymentSourceId ? ['Выберите источник оплаты'] : []),
  ]

  function submit() {
    if (blockReasons.length) { setShowErrors(true); toast(blockReasons[0], 'error'); return }
    setShowErrors(false)
    setBusy(true)
    const payload = {
      spent_on: spentOn,
      category_id: categoryId || null,
      name: name.trim(),
      quantity: qtyNum,
      unit: showQtyUnit ? unit.trim() : null,
      amount: kopecks as number,
      payment_source_id: paymentSourceId || null,
      supplier: supplier.trim() || null,
      comment: comment.trim() || null,
      kind,
      payment_status: paymentStatus,
      period_start: showPeriod ? (periodStart || null) : null,
      period_end: showPeriod ? (periodEnd || null) : null,
      ...(isSalary && salaryEmpId ? { source_kind: 'employee', source_id: salaryEmpId } : {}),
    }
    const op = isEdit ? updateExpense(expenseId as string, payload) : createExpense(payload)
    op
      .then(() => { toast(isEdit ? 'Изменения сохранены' : 'Расход добавлен', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setBusy(false))
  }

  function doPay() {
    if (!expenseId) return
    const srcId = paySourceId || paymentSourceId
    if (!srcId) { toast('Выберите источник оплаты', 'error'); return }
    // Пустое поле суммы → гасим весь остаток; иначе частичная оплата с проверкой остатка.
    const trimmed = payAmount.trim()
    let amount: number | null = null
    if (trimmed) {
      amount = parseRublesToKopecks(trimmed)
      if (amount == null || amount <= 0) { toast('Сумма оплаты — число больше нуля', 'error'); return }
      if (amount > remaining) { toast(`Оплата превышает остаток (${formatMoneyKopecks(remaining)})`, 'error'); return }
    }
    setBusy(true)
    payExpense(expenseId, { payment_source_id: srcId, paid_on: localTodayYmd(), amount })
      .then(() => { toast('Оплата проведена', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setBusy(false))
  }

  async function doUnpay() {
    if (!expenseId || !detail) return
    const ok = await confirm({
      title: 'Вернуть в «Ожидает оплаты»?',
      body: `${detail.exp_number} · ${detail.name}: отметка об оплате будет снята. Используйте, если расход помечен оплаченным по ошибке.`,
      confirmLabel: 'Вернуть в ожидание',
    })
    if (!ok) return
    setBusy(true)
    unpayExpense(expenseId)
      .then(() => { toast('Возвращено в ожидание оплаты', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setBusy(false))
  }

  async function doCancel() {
    if (!expenseId || !detail) return
    const ok = await confirm({
      title: 'Аннулировать расход?',
      body: `${detail.exp_number} · ${detail.name} будет аннулирован. Запись сохранится в журнале.`,
      danger: true, confirmLabel: 'Аннулировать',
    })
    if (!ok) return
    cancelExpense(expenseId)
      .then(() => { toast('Расход аннулирован', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !expenseId) return
    setUploading(true)
    uploadExpenseFile(expenseId, file)
      .then(() => { toast('Файл прикреплён', 'success'); reloadDetail() })
      .catch((err) => toast(err.message, 'error'))
      .finally(() => setUploading(false))
  }

  async function handleDeleteFile(fileId: string, fname: string) {
    if (!expenseId) return
    const ok = await confirm({ title: 'Удалить файл?', body: fname, danger: true, confirmLabel: 'Удалить' })
    if (!ok) return
    deleteExpenseFile(expenseId, fileId)
      .then(() => { toast('Файл удалён', 'success'); reloadDetail() })
      .catch((e) => toast(e.message, 'error'))
  }

  const inv = showErrors
  const dangerStyle = { borderColor: 'var(--c-danger)', background: 'var(--c-danger-bg)' }
  const kindWord = EXPENSE_KIND_LABELS[kind]
  const createTitle = isRent ? 'Оплата аренды' : kind === 'salary' ? 'Выплата ЗП' : 'Новый расход'
  const isAwaiting = isEdit && detail?.payment_status === 'awaiting'
  const isPartial = isEdit && detail?.payment_status === 'partially_paid'
  const isPaid = isEdit && detail?.payment_status === 'paid'
  const canPay = isAwaiting || isPartial
  const remaining = detail ? detail.amount - detail.paid_amount : 0
  const canSave = editableForm && (!isEdit || detail?.payment_status !== 'cancelled')
  // Закрывает крестик в шапке — отдельная кнопка не нужна; футер скрываем, если действий нет.
  const hasFooterButtons = !isEdit || canPay || isPaid || canSave

  return (
    <Modal
      open onClose={onClose} width={640}
      title={isEdit ? (detail ? `${detail.exp_number} · ${kindWord}` : 'Расход') : createTitle}
      subtitle={isEdit ? 'Любое изменение фиксируется в журнале ниже' : 'Дата по умолчанию — сегодня'}
      footer={
        hasFooterButtons ? (
          <>
            {!isEdit && <button className="btn ghost" onClick={onClose}>Отмена</button>}
            {isAwaiting && <button className="btn ghost danger" onClick={doCancel}>Аннулировать</button>}
            {(isPaid || isPartial) && (
              <button className="btn ghost" onClick={doUnpay} disabled={busy}>
                <Icon name="clock" size={14} />Вернуть в ожидание
              </button>
            )}
            {canSave && (
              <button className={canPay ? 'btn' : 'btn primary'} onClick={submit} disabled={busy || (isEdit && loadingDetail)}>
                <Icon name="check" size={14} />{busy ? 'Сохранение…' : isEdit ? 'Сохранить' : 'Добавить'}
              </button>
            )}
            {canPay && (
              <button className="btn primary" onClick={doPay} disabled={busy}>
                <Icon name="wallet" size={14} />{payAmount.trim() ? 'Внести оплату' : 'Оплатить полностью'}
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <input ref={fileRef} type="file" accept={ALLOWED_FILES} style={{ display: 'none' }} onChange={handleFileChange} />

      {isEdit && loadingDetail && !detail ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isEdit && detail && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Badge tone={expensePaymentTone(detail.payment_status)} dot>{detail.payment_status_label}</Badge>
              <span className="t-sub">{EXPENSE_KIND_LABELS[detail.kind]}</span>
              {detail.payment_status === 'paid' && detail.paid_on && (
                <span className="t-sub">· оплачено {detail.paid_on}</span>
              )}
              {detail.payment_status === 'partially_paid' && (
                <span className="t-sub">· оплачено {formatMoneyKopecks(detail.paid_amount)} из {formatMoneyKopecks(detail.amount)}</span>
              )}
            </div>
          )}

          {!isEdit && (
            <div>
              <FieldLabel>Статус оплаты</FieldLabel>
              <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', borderRadius: 10 }}>
                <PayStatusSeg
                  active={paymentStatus === 'paid'} icon="check" label={EXPENSE_PAYMENT_STATUS_LABELS.paid}
                  activeBg="var(--c-success-bg)" activeColor="var(--c-success)" onClick={() => setPaymentStatus('paid')}
                />
                <PayStatusSeg
                  active={paymentStatus === 'awaiting'} icon="clock" label={EXPENSE_PAYMENT_STATUS_LABELS.awaiting}
                  activeBg="var(--c-warning-bg)" activeColor="var(--c-warning)" onClick={() => setPaymentStatus('awaiting')}
                />
              </div>
            </div>
          )}

          {editableForm ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <FieldLabel required>Дата</FieldLabel>
                  <DatePicker value={spentOn} onChange={setSpentOn} invalid={inv && !spentOn} />
                </div>
                <div>
                  <FieldLabel required={kind === 'manual'}>Категория</FieldLabel>
                  <Combobox
                    value={categoryId || null}
                    onChange={(v) => setCategoryId(v ? String(v) : '')}
                    options={categories.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder="Выберите категорию…"
                    prefix="book"
                    invalid={inv && kind === 'manual' && !categoryId}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <FieldLabel required>{nameLabel}</FieldLabel>
                  {useEmployeePicker ? (
                    <>
                      <Combobox
                        value={salaryEmpId || null}
                        onChange={(v) => pickEmployee(v ? String(v) : '')}
                        options={(employees ?? []).map((e) => ({ value: e.id, label: e.full_name }))}
                        placeholder="Выберите сотрудника…"
                        prefix="user"
                        invalid={inv && !name.trim()}
                      />
                      {salaryEmpId && employees?.find((e) => e.id === salaryEmpId)?.comp_type === 'hourly' && (
                        <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 4 }}>
                          Почасовая оплата — сумму к выплате смотрите в табеле, затем впишите вручную.
                        </div>
                      )}
                    </>
                  ) : (
                    <input
                      className="input"
                      placeholder={isSalary ? 'ФИО сотрудника' : isRent ? 'например, аренда склада за июнь' : 'например, перчатки нитриловые M'}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      style={inv && !name.trim() ? dangerStyle : undefined}
                    />
                  )}
                </div>
                {showQtyUnit && (
                  <>
                    <div>
                      <FieldLabel required>Количество</FieldLabel>
                      <input
                        className="input" inputMode="decimal" placeholder="например, 5" value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        style={inv && !qtyValid ? dangerStyle : undefined}
                      />
                    </div>
                    <div>
                      <FieldLabel required>Ед. изм.</FieldLabel>
                      <input
                        className="input" list="expense-units" placeholder="шт / уп / л / кг" value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        style={inv && !unit.trim() ? dangerStyle : undefined}
                      />
                      <datalist id="expense-units">
                        {UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}
                      </datalist>
                    </div>
                  </>
                )}
                <div>
                  <FieldLabel required>Сумма, ₽</FieldLabel>
                  <input
                    className="input" inputMode="decimal" placeholder="например, 1500" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    style={inv && (kopecks == null || kopecks <= 0) ? dangerStyle : undefined}
                  />
                  {showQtyUnit && (
                    <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 4 }}>
                      {unitPrice != null ? `Цена за ед.: ${formatMoneyKopecks(unitPrice)}` : 'цена за ед. посчитается автоматически'}
                    </div>
                  )}
                </div>
                <div>
                  <FieldLabel required={needSource}>Источник оплаты</FieldLabel>
                  <Combobox
                    value={paymentSourceId || null}
                    onChange={(v) => setPaymentSourceId(v ? String(v) : '')}
                    options={paymentSources.map((s) => ({ value: s.id, label: s.name }))}
                    placeholder={needSource ? 'С чьей карты…' : 'необязательно до оплаты'}
                    prefix="wallet"
                    invalid={inv && needSource && !paymentSourceId}
                  />
                </div>
                {showPeriod && (
                  <>
                    <div>
                      <FieldLabel>Период с</FieldLabel>
                      <DatePicker value={periodStart} onChange={setPeriodStart} />
                    </div>
                    <div>
                      <FieldLabel>Период по</FieldLabel>
                      <DatePicker value={periodEnd} onChange={setPeriodEnd} />
                    </div>
                  </>
                )}
                {!isSalary && (
                  <div>
                    <FieldLabel>{isRent ? 'Арендодатель' : 'Поставщик / магазин'}</FieldLabel>
                    <input className="input" placeholder="необязательно" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                  </div>
                )}
                <div style={{ gridColumn: '1 / -1' }}>
                  <FieldLabel>Комментарий</FieldLabel>
                  <textarea className="input" rows={2} style={{ resize: 'vertical' }} placeholder="необязательно" value={comment} onChange={(e) => setComment(e.target.value)} />
                </div>
              </div>

              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={onManageDicts}>
                <Icon name="book" size={13} />Справочники: категории и источники оплаты
              </button>
            </>
          ) : detail && (
            <ReadonlySummary
              detail={detail}
              onOpenTrip={() => { onClose(); navigate(`/logistics/trips/${detail.source_id}`) }}
            />
          )}

          {canPay && detail && (
            <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {detail.paid_amount > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--c-text-muted)' }}>Оплачено {formatMoneyKopecks(detail.paid_amount)} из {formatMoneyKopecks(detail.amount)}</span>
                    <span style={{ color: 'var(--c-text-muted)' }}>Остаток: <span className="mono">{formatMoneyKopecks(remaining)}</span></span>
                  </div>
                  <div className="prog" style={{ height: 6 }}>
                    <div className="prog-fill ok" style={{ width: `${Math.round(expensePaidFraction(detail.amount, detail.paid_amount) * 100)}%` }} />
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <FieldLabel>Сумма платежа, ₽</FieldLabel>
                  <input
                    className="input" inputMode="decimal"
                    placeholder={`весь остаток (${formatMoneyKopecks(remaining)})`}
                    value={payAmount} onChange={(e) => setPayAmount(e.target.value)}
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginTop: 4 }}>
                    Пусто — гасим остаток полностью
                  </div>
                </div>
                <div>
                  <FieldLabel>Оплатить с карты</FieldLabel>
                  <Combobox
                    value={paySourceId || null}
                    onChange={(v) => setPaySourceId(v ? String(v) : '')}
                    options={paymentSources.map((s) => ({ value: s.id, label: s.name }))}
                    placeholder="С чьей карты…"
                    prefix="wallet"
                  />
                </div>
              </div>
            </div>
          )}

          {isEdit && detail && detail.payments.length > 0 && (
            <Section icon="wallet" title="Платежи" count={detail.payments.length}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {detail.payments.map((p, i, arr) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                    <span className="mono" style={{ fontWeight: 600, fontSize: 13, minWidth: 96 }}>{formatMoneyKopecks(p.amount)}</span>
                    <span style={{ flex: 1, fontSize: 12.5, color: 'var(--c-text-muted)' }}>
                      {p.paid_on ?? '—'}{p.payment_source_name ? ` · ${p.payment_source_name}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {isEdit && detail && (
            <>
              <Section icon="paperclip" title="Чек / фото" count={detail.files.length}
                right={
                  <button className="btn ghost sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    <Icon name={uploading ? 'refresh' : 'paperclip'} size={12} />{uploading ? 'Загрузка…' : 'Прикрепить'}
                  </button>
                }>
                {detail.files.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>Скан или фото чека не прикреплены.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {detail.files.map((f) => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)' }}>
                        <FileTypeIcon filename={f.filename} />
                        <a href={resolvePublicUploadSrc(f.url)} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--c-text)', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.filename}
                        </a>
                        <a href={resolvePublicUploadSrc(f.url)} target="_blank" rel="noreferrer" className="btn ghost icon sm" title="Скачать"><Icon name="download" size={13} /></a>
                        <button className="btn ghost icon sm" title="Удалить" onClick={() => handleDeleteFile(f.id, f.filename)}><Icon name="trash" size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section icon="history" title="История изменений" count={detail.ops.length}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {detail.ops.slice().reverse().map((op, i, arr) => (
                    <div key={op.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--c-border)' : 'none' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: OP_DOT[op.op_type] ?? 'var(--c-border-strong)', marginTop: 5, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13 }}>
                          <span style={{ fontWeight: 500 }}>{EXPENSE_OP_LABELS[op.op_type] ?? op.op_type}</span>
                          {op.comment && <span style={{ color: 'var(--c-text-muted)' }}> — {op.comment}</span>}
                        </div>
                        <div className="t-sub">{fmtDateTime(op.created_at)}{op.created_by_email ? ` · ${op.created_by_email}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}

          {showErrors && blockReasons.length > 0 && (
            <div className="block-reasons">
              {blockReasons.map((r, i) => <div key={i}>· {r}</div>)}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function ReadonlySummary({ detail, onOpenTrip }: {
  detail: import('../../../../api/expensesApi').ExpenseDetail
  onOpenTrip: () => void
}) {
  const rows: Array<[string, string | null]> = [
    ['Тип', EXPENSE_KIND_LABELS[detail.kind]],
    ['Дата', detail.spent_on],
    ['Сумма', formatMoneyKopecks(detail.amount)],
    ['Категория', detail.category_name],
    ['Контрагент', detail.supplier],
    ['Период', detail.period_start ? `${detail.period_start} — ${detail.period_end ?? '…'}` : null],
    ['Источник оплаты', detail.payment_source_name],
    ['Комментарий', detail.comment],
  ]
  const isTrip = detail.source_kind === 'trip' && !!detail.source_id
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 8, columnGap: 12, alignItems: 'baseline' }}>
      {rows.filter(([, v]) => v).map(([k, v]) => (
        <FragmentRow key={k} label={k} value={v as string} />
      ))}
      {isTrip && (
        <>
          <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>Рейс</span>
          <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={onOpenTrip}>
            <Icon name="truckIn" size={13} />{detail.source_trip_number ? `Рейс ${detail.source_trip_number}` : 'Открыть рейс'}
          </button>
        </>
      )}
    </div>
  )
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </>
  )
}

function Section({ icon, title, count, right, children }: {
  icon: 'paperclip' | 'history' | 'wallet'
  title: string
  count?: number
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)' }}>
        <Icon name={icon} size={14} style={{ color: 'var(--c-text-muted)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
        {count != null && (
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--c-text-subtle)', background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', padding: '1px 7px', borderRadius: 99 }}>{count}</span>
        )}
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  )
}
