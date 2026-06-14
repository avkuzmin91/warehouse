import { useState } from 'react'
import {
  addInvoicePayment,
  attachInvoiceShipments,
  getUninvoicedShipments,
  parseDueHistory,
  updateInvoiceAmount,
  updateInvoiceDueDate,
} from '../../../api/invoicesApi'
import type { InvoiceDetail } from '../../../api/invoicesApi'
import { Modal } from '../../feedback/Modal'
import { DatePicker } from '../../primitives/DatePicker'
import { Icon } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { useToast } from '../../feedback/Toast'
import { fmtDate, fmtDateTime, formatMoneyKopecks, parseRublesToKopecks } from '../../../utils/format'
import { CargoTag } from './financeUI'

function FieldRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)' }}>{label}</span>
        {required && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-text-faint)' }}>обяз.</span>}
      </div>
      {children}
    </div>
  )
}

// ── Внести оплату ────────────────────────────────────────────────────────────
export function PayModal({ invoice, onClose, onDone }: { invoice: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const kopecks = parseRublesToKopecks(amount)
  const total = invoice.total_amount
  const paid = invoice.paid_amount
  const remaining = Math.max(0, total - paid)
  const addNow = kopecks && kopecks > 0 ? Math.min(kopecks, remaining) : 0
  const pctPaid = total > 0 ? Math.min(100, (paid / total) * 100) : 0
  const pctNew = total > 0 ? Math.min(100 - pctPaid, (addNow / total) * 100) : 0
  const afterRemaining = Math.max(0, remaining - (kopecks ?? 0))
  const over = kopecks != null && kopecks > remaining
  const amountInvalid = (showErrors && (kopecks == null || kopecks <= 0)) || over

  function submit() {
    if (kopecks == null || kopecks <= 0) { setShowErrors(true); toast('Укажите сумму оплаты', 'error'); return }
    if (over) { toast(`Оплата превышает остаток по счёту (${formatMoneyKopecks(remaining)})`, 'error'); return }
    if (!paidOn) { setShowErrors(true); toast('Укажите дату оплаты', 'error'); return }
    setBusy(true)
    addInvoicePayment(invoice.id, { amount: kopecks, paid_on: paidOn, comment: comment.trim() || null })
      .then(() => { toast('Оплата внесена', 'success'); onDone() })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      open onClose={onClose} title="Внести оплату" width={440}
      subtitle={`Остаток: ${formatMoneyKopecks(remaining)}`}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" onClick={submit} disabled={busy}><Icon name="check" size={14} />Внести</button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--c-bg-sunken)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 6 }}>
            <span>Оплачено {formatMoneyKopecks(paid)}</span>
            <span>из {formatMoneyKopecks(total)}</span>
          </div>
          <div className="prog" style={{ height: 8, position: 'relative' }}>
            <div className="prog-fill warn" style={{ width: `${pctPaid}%` }} />
            {pctNew > 0 && (
              <div style={{
                position: 'absolute', top: 0, left: `${pctPaid}%`, width: `${pctNew}%`, height: '100%',
                background: 'repeating-linear-gradient(45deg, color-mix(in oklab, var(--c-success) 45%, transparent) 0 4px, transparent 4px 8px)',
              }} />
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 6 }}>
            {addNow > 0
              ? <>После оплаты <b className="mono" style={{ color: 'var(--c-success)' }}>{formatMoneyKopecks(kopecks ?? 0)}</b> остаток составит <b className="mono">{formatMoneyKopecks(afterRemaining)}</b></>
              : 'Введите сумму, чтобы увидеть остаток после оплаты.'}
          </div>
        </div>
        <FieldRow label="Сумма, ₽" required>
          <input
            className="input" inputMode="decimal" autoFocus placeholder="например, 50000" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={amountInvalid ? { borderColor: 'var(--c-danger)', background: 'var(--c-danger-bg)' } : undefined}
          />
          <div style={{ fontSize: 11.5, color: (amount && kopecks == null) || amountInvalid ? 'var(--c-danger)' : 'var(--c-text-subtle)', marginTop: 4 }}>
            {amount && kopecks == null ? 'Введите число' : over ? `Превышает остаток ${formatMoneyKopecks(remaining)}` : (showErrors && (kopecks == null || kopecks <= 0)) ? 'Укажите сумму оплаты' : formatMoneyKopecks(kopecks ?? 0)}
          </div>
        </FieldRow>
        <FieldRow label="Дата оплаты" required>
          <DatePicker value={paidOn} onChange={setPaidOn} invalid={showErrors && !paidOn} />
        </FieldRow>
        <FieldRow label="Комментарий">
          <input className="input" placeholder="Необязательно" value={comment} onChange={(e) => setComment(e.target.value)} />
        </FieldRow>
      </div>
    </Modal>
  )
}

// ── Перенести срок расчёта (с историей переносов) ──────────────────────────────
export function DueModal({ invoice, onClose, onDone }: { invoice: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [date, setDate] = useState(invoice.due_date ?? '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const changes = parseDueHistory(invoice.ops)
  const current = invoice.due_date
  const showProspective = !!date && date !== current

  type Row = { date: string; tag: string; accent?: boolean; at?: string }
  const rows: Row[] = []
  if (showProspective) rows.push({ date, tag: 'новая', accent: true })
  if (current) rows.push({ date: current, tag: 'текущая', at: changes.length ? changes[changes.length - 1].at : undefined })
  for (let i = changes.length - 1; i >= 0; i--) {
    if (changes[i].from) rows.push({ date: changes[i].from as string, tag: i === 0 ? 'исходная' : 'ранее', at: changes[i].at })
  }

  function submit() {
    if (!date) { setShowErrors(true); toast('Укажите новую плановую дату расчёта', 'error'); return }
    setBusy(true)
    updateInvoiceDueDate(invoice.id, date, reason)
      .then(() => { toast('Срок перенесён', 'success'); onDone() })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      open onClose={onClose} title="Перенести срок расчёта" width={440}
      subtitle={`Текущий срок: ${fmtDate(invoice.due_date)} (сохранится в журнале)`}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" onClick={submit} disabled={busy}><Icon name="check" size={14} />Сохранить</button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <FieldRow label="Новая плановая дата" required>
          <DatePicker value={date} onChange={setDate} invalid={showErrors && !date} />
        </FieldRow>
        <FieldRow label="Причина переноса">
          <input className="input" placeholder="Необязательно (например, договорённость с клиентом)" value={reason} onChange={(e) => setReason(e.target.value)} />
        </FieldRow>
        {rows.length > 1 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 8 }}>
              <Icon name="history" size={13} />История переносов
            </div>
            <div>
              {rows.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 10 }}>
                  <div style={{ width: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', marginTop: 4, background: h.accent ? 'var(--c-accent)' : 'var(--c-border-strong)' }} />
                    {i < rows.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--c-border)' }} />}
                  </div>
                  <div style={{ paddingBottom: i < rows.length - 1 ? 12 : 0, display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{fmtDate(h.date)}</span>
                    <span className={`badge ${h.accent ? 'accent' : ''}`} style={{ height: 18 }}>{h.tag}</span>
                    <span className="mono" style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-subtle)' }}>
                      {h.accent ? 'сейчас' : h.at ? fmtDateTime(h.at) : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Скорректировать сумму выставленного счёта (спор клиента) ────────────────────
export function AmountModal({ invoice, onClose, onDone }: { invoice: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState(invoice.total_amount ? String(invoice.total_amount / 100) : '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const kopecks = parseRublesToKopecks(amount)
  const paid = invoice.paid_amount
  const belowPaid = kopecks != null && kopecks < paid
  const changed = kopecks != null && kopecks !== invoice.total_amount
  const afterRemaining = kopecks != null ? Math.max(0, kopecks - paid) : null
  const amountInvalid = (showErrors && (kopecks == null || kopecks <= 0)) || belowPaid
  const reasonInvalid = showErrors && !reason.trim()

  function submit() {
    if (kopecks == null || kopecks <= 0) { setShowErrors(true); toast('Укажите сумму', 'error'); return }
    if (belowPaid) { toast(`Сумма меньше уже оплаченной (${formatMoneyKopecks(paid)})`, 'error'); return }
    if (!changed) { toast('Сумма не изменилась', 'error'); return }
    if (!reason.trim()) { setShowErrors(true); toast('Укажите причину корректировки', 'error'); return }
    setBusy(true)
    updateInvoiceAmount(invoice.id, { total_amount: kopecks, reason: reason.trim() })
      .then(() => { toast('Сумма скорректирована', 'success'); onDone() })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      open onClose={onClose} title="Скорректировать сумму" width={440}
      subtitle={`Счёт ${invoice.doc_number} · текущая ${formatMoneyKopecks(invoice.total_amount)}`}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Отмена</button>
        <button className="btn primary" onClick={submit} disabled={busy}><Icon name="check" size={14} />Сохранить</button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--c-bg-sunken)', fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--c-text-subtle)' }}>
            <span>Текущая сумма</span><span className="mono">{formatMoneyKopecks(invoice.total_amount)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--c-text-subtle)', marginTop: 4 }}>
            <span>Оплачено</span><span className="mono">{formatMoneyKopecks(paid)}</span>
          </div>
          {afterRemaining != null && changed && !belowPaid && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--c-border)', fontWeight: 600 }}>
              <span>Остаток после корректировки</span><span className="mono">{formatMoneyKopecks(afterRemaining)}</span>
            </div>
          )}
        </div>
        <FieldRow label="Новая сумма, ₽" required>
          <input
            className="input" inputMode="decimal" autoFocus placeholder="например, 120000" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={amountInvalid ? { borderColor: 'var(--c-danger)', background: 'var(--c-danger-bg)' } : undefined}
          />
          <div style={{ fontSize: 11.5, color: (amount && kopecks == null) || amountInvalid ? 'var(--c-danger)' : 'var(--c-text-subtle)', marginTop: 4 }}>
            {amount && kopecks == null ? 'Введите число'
              : belowPaid ? `Меньше уже оплаченной (${formatMoneyKopecks(paid)}) — сначала оформите возврат`
              : (showErrors && (kopecks == null || kopecks <= 0)) ? 'Укажите сумму'
              : formatMoneyKopecks(kopecks ?? 0)}
          </div>
        </FieldRow>
        <FieldRow label="Причина корректировки" required>
          <textarea
            className="input" rows={2} style={{ resize: 'vertical', ...(reasonInvalid ? { borderColor: 'var(--c-danger)', background: 'var(--c-danger-bg)' } : null) }}
            placeholder="Например: клиент оспорил тариф по WH-00123, согласована новая сумма" value={reason} onChange={(e) => setReason(e.target.value)}
          />
          {reasonInvalid && <div style={{ fontSize: 11.5, color: 'var(--c-danger)', marginTop: 4 }}>Укажите причину корректировки.</div>}
        </FieldRow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
          <Icon name="paperclip" size={12} />После корректировки приложите обновлённый расчёт и отправьте счёт клиенту.
        </div>
      </div>
    </Modal>
  )
}

// ── Привязать отгрузки (завершённые отгрузки клиента без счёта) ─────────────────
export function AttachModal({ invoice, onClose, onDone }: { invoice: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const { data, loading } = useApi(
    (s) => invoice.client_id
      ? getUninvoicedShipments({ client_id: invoice.client_id, limit: 200 }, s)
      : Promise.resolve({ items: [], total: 0, page: 1, limit: 200 }),
    [invoice.client_id],
  )
  const shipments = data?.items ?? []

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAll() {
    setSelected((prev) => prev.size === shipments.length ? new Set() : new Set(shipments.map((s) => s.id)))
  }

  function submit() {
    if (selected.size === 0) { toast('Выберите хотя бы одну отгрузку', 'error'); return }
    setBusy(true)
    attachInvoiceShipments(invoice.id, [...selected])
      .then(() => { toast('Отгрузки добавлены', 'success'); onDone() })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      open onClose={onClose} title="Добавить отгрузки" width={560}
      subtitle={`Завершённые отгрузки клиента ${invoice.client_name ?? ''} без счёта`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, width: '100%' }}>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>Выбрано: <b>{selected.size}</b></span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Отмена</button>
            <button className="btn primary" onClick={submit} disabled={busy}>
              <Icon name="plus" size={14} />Добавить ({selected.size})
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
        <Icon name="lock" size={12} />Отгрузка, привязанная к другому счёту, здесь не появится.
        {shipments.length > 0 && (
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={toggleAll}>
            {selected.size === shipments.length ? 'Снять все' : 'Выбрать все'}
          </button>
        )}
      </div>
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      ) : shipments.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет доступных отгрузок</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
          {shipments.map((s) => {
            const on = selected.has(s.id)
            return (
              <label key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 'var(--r-md)', cursor: 'pointer',
                border: `1px solid ${on ? 'var(--c-accent-border)' : 'var(--c-border)'}`,
                background: on ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)',
              }}>
                <span className={`t-checkbox ${on ? 'checked' : ''}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {on && <Icon name="check" size={10} />}
                </span>
                <input type="checkbox" checked={on} onChange={() => toggle(s.id)} style={{ display: 'none' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ fontWeight: 500 }}>{s.doc_number}</span>
                    <CargoTag cargoType={s.cargo_type} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 2 }}>{s.destination ?? '—'} · {fmtDate(s.ship_date)}</div>
                </div>
                <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{s.total_qty} шт · {s.sku_count} SKU</span>
              </label>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
