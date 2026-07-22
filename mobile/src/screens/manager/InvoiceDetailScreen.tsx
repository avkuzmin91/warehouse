import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  addInvoiceDiscount,
  addInvoicePayment,
  getInvoice,
  invoiceStatusTone,
  INVOICE_OP_LABELS,
  INVOICE_STATUS_LABELS,
  removeInvoiceDiscount,
  type InvoiceDetail,
} from '../../api/invoicesApi'
import { AppBar } from '../../components/AppBar'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { DateField } from '../../components/DateField'
import { Icon } from '../../components/Icon'
import { TextArea } from '../../components/TextArea'
import { useHardwareBack } from '../../nav/backHandlers'
import { fmtDate, fmtDateTime, formatMoneyKopecks, moscowTodayYmd, parseRublesToKopecks } from '../../utils/format'

export function InvoiceDetailScreen({ invoiceId }: { invoiceId: string }) {
  const { back } = useNav()
  const [doc, setDoc] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paySheet, setPaySheet] = useState(false)
  const [discountSheet, setDiscountSheet] = useState(false)
  const [removingDiscount, setRemovingDiscount] = useState<string | null>(null)

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    getInvoice(invoiceId, signal)
      .then((d) => { if (!signal?.aborted) setDoc(d) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить счёт') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [invoiceId])

  useEffect(() => {
    const ac = new AbortController()
    load(ac.signal)
    return () => ac.abort()
  }, [load])

  const remaining = doc ? Math.max(0, doc.total_amount - doc.paid_amount) : 0
  const active = doc?.status === 'issued' || doc?.status === 'partially_paid'
  const mutable = active || doc?.status === 'draft'
  const tone = doc ? (doc.overdue && active ? 'danger' : invoiceStatusTone(doc.status)) : ''

  async function handleRemoveDiscount(discountId: string) {
    if (!doc || removingDiscount) return
    setRemovingDiscount(discountId)
    try {
      await removeInvoiceDiscount(doc.id, discountId)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось снять скидку')
    } finally {
      setRemovingDiscount(null)
    }
  }

  return (
    <div className="screen">
      <AppBar title={doc ? doc.doc_number : 'Счёт'} sub={doc ? INVOICE_STATUS_LABELS[doc.status] : ''} onBack={back} noProfile />
      <div className="scroll pad-nav">
        {error && (<div className="alert"><Icon name="alert" size={15} />{error}</div>)}
        {loading || !doc ? (
          !error && <div className="center" style={{ padding: '32px 0' }}><div className="spin" /></div>
        ) : (
          <>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv"><span className="k">Статус</span>
                <span className="v">
                  {tone
                    ? <span className={`badge ${tone}`}><span className="dot" />{doc.overdue && active ? 'Просрочен' : INVOICE_STATUS_LABELS[doc.status]}</span>
                    : INVOICE_STATUS_LABELS[doc.status]}
                </span>
              </div>
              <div className="kv"><span className="k">Клиент</span><span className="v">{doc.client_name ?? '—'}</span></div>
              <div className="kv"><span className="k">Сумма</span><span className="v mono">{formatMoneyKopecks(doc.total_amount)}</span></div>
              {doc.discount_kop > 0 && (
                <div className="kv"><span className="k">Скидка</span><span className="v mono" style={{ color: 'var(--c-danger)' }}>−{formatMoneyKopecks(doc.discount_kop)}</span></div>
              )}
              <div className="kv"><span className="k">Оплачено</span><span className="v mono">{formatMoneyKopecks(doc.paid_amount)}</span></div>
              {active && (
                <div className="kv"><span className="k">Остаток</span><span className="v mono">{formatMoneyKopecks(remaining)}</span></div>
              )}
              <div className="kv"><span className="k">Срок оплаты</span><span className="v">{fmtDate(doc.due_date)}</span></div>
              {doc.comment && (<div className="kv"><span className="k">Комментарий</span><span className="v">{doc.comment}</span></div>)}
            </div>

            {(active || mutable) && (
              <div className="row gap-8" style={{ marginBottom: 16 }}>
                {active && (
                  <button className="btn" style={{ flex: 1 }} onClick={() => setPaySheet(true)}>
                    <Icon name="plus" size={15} /> Внести платёж
                  </button>
                )}
                {mutable && (
                  <button className="btn ghost" style={{ flex: 1 }} onClick={() => setDiscountSheet(true)}>
                    <Icon name="tag" size={15} /> Скидка
                  </button>
                )}
              </div>
            )}

            {(doc.shipments.length > 0 || doc.receipts.length > 0 || doc.extra_income.length > 0) && (
              <>
                <div className="sec">
                  Приложения
                  <span className="sec-count">{doc.shipments.length + doc.receipts.length + doc.extra_income.length}</span>
                </div>
                <div className="line" style={{ padding: '2px 14px' }}>
                  {doc.shipments.map((s) => (
                    <div key={s.shipment_doc_id} className="oprow">
                      <div className="oprow-t">Отгрузка {s.doc_number} · {s.total_qty} шт</div>
                      <div className="oprow-m">{s.status_label}{s.ship_date ? ` · ${fmtDate(s.ship_date)}` : ''}</div>
                    </div>
                  ))}
                  {doc.receipts.map((r) => (
                    <div key={r.receipt_doc_id} className="oprow">
                      <div className="oprow-t">Поступление {r.doc_number} · {r.total_qty} шт</div>
                      <div className="oprow-m">{r.status_label}{r.arrival_date ? ` · ${fmtDate(r.arrival_date)}` : ''}</div>
                    </div>
                  ))}
                  {doc.extra_income.map((e) => (
                    <div key={e.entry_id} className="oprow">
                      <div className="oprow-t">Доп. работа · {formatMoneyKopecks(e.amount_kop)}</div>
                      <div className="oprow-m">{e.category_name ?? '—'} · {fmtDate(e.entry_date)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {doc.discounts.length > 0 && (
              <>
                <div className="sec" style={{ marginTop: 16 }}>Скидки<span className="sec-count">{doc.discounts.length}</span></div>
                <div className="line" style={{ padding: '2px 14px' }}>
                  {doc.discounts.map((d) => (
                    <div key={d.id} className="oprow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="oprow-t" style={{ color: 'var(--c-danger)' }}>−{formatMoneyKopecks(d.amount_kop)}</div>
                        <div className="oprow-m">{d.reason} · {fmtDate(d.created_at.slice(0, 10))}{d.created_by_name ? ` · ${d.created_by_name}` : ''}</div>
                      </div>
                      {mutable && (
                        <button
                          className="btn ghost icon" disabled={removingDiscount === d.id}
                          onClick={() => void handleRemoveDiscount(d.id)} aria-label="Снять скидку"
                        >
                          {removingDiscount === d.id ? <span className="spin spin-sm" /> : <Icon name="x" size={15} />}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {doc.payments.length > 0 && (
              <>
                <div className="sec" style={{ marginTop: 16 }}>Платежи<span className="sec-count">{doc.payments.length}</span></div>
                <div className="line" style={{ padding: '2px 14px' }}>
                  {doc.payments.map((p) => (
                    <div key={p.id} className="oprow">
                      <div className="oprow-t">{formatMoneyKopecks(p.amount)}{p.comment ? ` · ${p.comment}` : ''}</div>
                      <div className="oprow-m">{fmtDate(p.paid_on)}{p.created_by_email ? ` · ${p.created_by_email}` : ''}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {doc.ops.length > 0 && (
              <CollapsibleSection title="История" count={doc.ops.length} style={{ marginTop: 16 }}>
                <div className="line" style={{ padding: '2px 14px' }}>
                  {doc.ops.map((op) => (
                    <div key={op.id} className="oprow">
                      <div className="oprow-t">{op.comment ?? INVOICE_OP_LABELS[op.op_type]}</div>
                      <div className="oprow-m">{fmtDateTime(op.created_at)}{op.created_by_email ? ` · ${op.created_by_email}` : ''}</div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </>
        )}
      </div>

      {discountSheet && doc && (
        <DiscountSheet
          remainingKop={remaining}
          onClose={() => setDiscountSheet(false)}
          onSave={async (payload) => {
            await addInvoiceDiscount(doc.id, payload)
            setDiscountSheet(false)
            load()
          }}
        />
      )}

      {paySheet && doc && (
        <PaymentSheet
          remainingKop={remaining}
          onClose={() => setPaySheet(false)}
          onSave={async (payload) => {
            await addInvoicePayment(doc.id, payload)
            setPaySheet(false)
            load()
          }}
        />
      )}
    </div>
  )
}

// Шторка скидки: сумма в рублях + обязательный текст «за что». Скидка уменьшает
// сумму счёта и автоматически заводит расход kind=discount в реестре.
function DiscountSheet({
  remainingKop,
  onClose,
  onSave,
}: {
  remainingKop: number
  onClose: () => void
  onSave: (payload: { amount_kop: number; reason: string }) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const kop = parseRublesToKopecks(amount)
  const over = kop != null && kop > remainingKop

  async function submit() {
    if (saving) return
    if (kop == null || kop <= 0) { setError('Укажите сумму скидки'); return }
    if (over) { setError(`Скидка превышает остаток к оплате (${formatMoneyKopecks(remainingKop)})`); return }
    if (!reason.trim()) { setError('Укажите, за что предоставлена скидка'); return }
    setSaving(true)
    setError('')
    try {
      await onSave({ amount_kop: kop, reason: reason.trim() })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить скидку')
      setSaving(false)
    }
  }

  useHardwareBack(() => { if (!saving) onClose() })

  return (
    <div className="sheet-backdrop" onClick={() => { if (!saving) onClose() }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Скидка клиенту</h3>

        <div className="flabel">Сумма скидки, ₽</div>
        <input
          className="input num"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
        />
        <div className="line-sub" style={{ marginTop: 4 }}>Остаток к оплате: {formatMoneyKopecks(remainingKop)}</div>

        <div className="flabel" style={{ marginTop: 10 }}>За что скидка</div>
        <TextArea value={reason} onChange={setReason} placeholder="Например: компенсация за пересорт при упаковке" minRows={2} />

        {error && (<div className="alert" style={{ marginTop: 10 }}><Icon name="alert" size={15} />{error}</div>)}

        <div className="dtf-actions">
          <button className="btn ghost" disabled={saving} onClick={onClose}>Отмена</button>
          <button className="btn" disabled={saving || kop == null || kop <= 0 || over || !reason.trim()} onClick={() => void submit()}>
            {saving ? <span className="spin spin-sm" /> : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Шторка платежа: сумма в рублях (по умолчанию остаток), дата и комментарий.
function PaymentSheet({
  remainingKop,
  onClose,
  onSave,
}: {
  remainingKop: number
  onClose: () => void
  onSave: (payload: { amount: number; paid_on?: string | null; comment?: string | null }) => Promise<void>
}) {
  const [amount, setAmount] = useState(remainingKop > 0 ? String(remainingKop / 100).replace('.', ',') : '')
  const [paidOn, setPaidOn] = useState(moscowTodayYmd())
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const kop = parseRublesToKopecks(amount)

  async function submit() {
    if (saving) return
    if (kop == null || kop <= 0) {
      setError('Укажите сумму платежа')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave({ amount: kop, paid_on: paidOn || null, comment: comment.trim() || null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось внести платёж')
      setSaving(false)
    }
  }

  useHardwareBack(() => { if (!saving) onClose() })

  return (
    <div className="sheet-backdrop" onClick={() => { if (!saving) onClose() }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Платёж по счёту</h3>

        <div className="flabel">Сумма, ₽</div>
        <input
          className="input num"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
        />
        {remainingKop > 0 && (
          <div className="line-sub" style={{ marginTop: 4 }}>Остаток по счёту: {formatMoneyKopecks(remainingKop)}</div>
        )}

        <div className="flabel" style={{ marginTop: 10 }}>Дата оплаты</div>
        <DateField value={paidOn} onChange={setPaidOn} title="Дата оплаты" />

        <div className="flabel" style={{ marginTop: 10 }}>Комментарий</div>
        <TextArea value={comment} onChange={setComment} placeholder="Например: платёжное поручение №…" minRows={2} />

        {error && (<div className="alert" style={{ marginTop: 10 }}><Icon name="alert" size={15} />{error}</div>)}

        <div className="dtf-actions">
          <button className="btn ghost" disabled={saving} onClick={onClose}>Отмена</button>
          <button className="btn" disabled={saving || kop == null || kop <= 0} onClick={() => void submit()}>
            {saving ? <span className="spin spin-sm" /> : 'Внести'}
          </button>
        </div>
      </div>
    </div>
  )
}
