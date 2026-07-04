import { useState } from 'react'
import {
  createExtraIncome,
  deleteExtraIncome,
  updateExtraIncome,
} from '../../../../api/extraIncomeApi'
import type { ExtraIncomeCategory, ExtraIncomeListItem } from '../../../../api/extraIncomeApi'
import { Combobox } from '../../../data/Combobox'
import { Modal } from '../../../feedback/Modal'
import { Icon } from '../../../primitives/Icon'
import { useToast } from '../../../feedback/Toast'
import { useConfirm } from '../../../feedback/ConfirmDialog'
import { useLookups } from '../../../../hooks/useLookups'
import { formatMoneyKopecks, localTodayYmd, parseRublesToKopecks } from '../../../../utils/format'

const labelStyle = { fontSize: 12, fontWeight: 600 as const, color: 'var(--c-text-muted)', marginBottom: 4, display: 'block' }

export function ExtraIncomeModal({ entry, categories, onClose, onSaved }: {
  entry: ExtraIncomeListItem | null      // null = создание
  categories: ExtraIncomeCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const { clients } = useLookups()

  const [entryDate, setEntryDate] = useState(entry?.entry_date ?? localTodayYmd())
  const [clientId, setClientId] = useState(entry?.client_id ?? '')
  const [categoryId, setCategoryId] = useState(entry?.category_id ?? '')
  const [qty, setQty] = useState(entry?.qty != null ? String(entry.qty) : '')
  const [amount, setAmount] = useState(entry ? String(entry.amount_kop / 100) : '')
  const [comment, setComment] = useState(entry?.comment ?? '')
  // Хранится всегда итог (amount_kop); «за единицу» — только режим ввода на форме.
  const [perUnit, setPerUnit] = useState(false)
  const [busy, setBusy] = useState(false)

  // Запись, вошедшая в счёт, менять нельзя (сумма счёта разойдётся с составом) —
  // backend это отклонит, здесь просто read-only с подсказкой.
  const locked = !!entry?.invoice_id

  const kopecks = parseRublesToKopecks(amount)
  const qtyNum = qty.trim() ? Number(qty) : null
  const qtyValid = qtyNum != null && Number.isInteger(qtyNum) && qtyNum > 0
  const totalKop = perUnit
    ? (kopecks != null && qtyValid ? kopecks * qtyNum : null)
    : kopecks
  const problems = [
    ...(!entryDate ? ['Укажите дату'] : []),
    ...(!clientId ? ['Выберите клиента'] : []),
    ...(!categoryId ? ['Выберите вид работы'] : []),
    ...(perUnit && !qtyValid ? ['Для цены за единицу укажите количество'] : []),
    ...(kopecks == null || kopecks <= 0 ? [perUnit ? 'Цена за единицу — число больше нуля' : 'Сумма — число больше нуля'] : []),
    ...(qtyNum != null && !qtyValid ? ['Количество — целое число больше нуля'] : []),
  ]

  function save() {
    if (problems.length) { toast(problems[0], 'error'); return }
    setBusy(true)
    const payload = {
      entry_date: entryDate,
      client_id: clientId,
      category_id: categoryId,
      qty: qtyNum,
      amount_kop: totalKop as number,
      comment: comment.trim() || null,
    }
    const req = entry ? updateExtraIncome(entry.id, payload) : createExtraIncome(payload)
    req
      .then(() => { toast(entry ? 'Запись обновлена' : 'Доп. работа добавлена', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setBusy(false))
  }

  async function remove() {
    if (!entry) return
    const ok = await confirm({
      title: 'Удалить запись?',
      body: `Доп. работа от ${entry.entry_date} на ${formatMoneyKopecks(entry.amount_kop)} будет удалена и исчезнет из аналитики.`,
      danger: true, confirmLabel: 'Удалить',
    })
    if (!ok) return
    setBusy(true)
    deleteExtraIncome(entry.id)
      .then(() => { toast('Запись удалена', 'success'); onSaved() })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal open onClose={onClose} width={480}
      title={entry ? 'Доп. работа' : 'Новая доп. работа'}
      subtitle={entry ? `Заведено ${entry.created_at.slice(0, 10)}` : 'Доход за работу, не привязанную к отгрузке: переборка, переклейка ШК и т.п.'}
      footer={
        <>
          {entry && !locked && (
            <button className="btn ghost" style={{ color: 'var(--c-danger)', marginRight: 'auto' }} disabled={busy} onClick={remove}>
              <Icon name="trash" size={14} />Удалить
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          {!locked && (
            <button className="btn primary" disabled={busy} onClick={save}>
              <Icon name="check" size={14} />{entry ? 'Сохранить' : 'Добавить'}
            </button>
          )}
        </>
      }
    >
      {locked && (
        <div className="card" style={{ padding: '8px 10px', marginBottom: 12, fontSize: 12.5, color: 'var(--c-text-muted)', background: 'var(--c-bg-sunken)' }}>
          <Icon name="lock" size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
          Запись входит в счёт {entry?.invoice_number} — изменение и удаление недоступны, пока она привязана к счёту.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={labelStyle}>Дата работы</label>
          <input type="date" className="input" value={entryDate} disabled={locked}
            onChange={(e) => setEntryDate(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Вид работы</label>
          <Combobox
            value={categoryId || null}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => setCategoryId(v ? String(v) : '')}
            placeholder="Выбрать…"
            disabled={locked}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Клиент</label>
          <Combobox
            value={clientId || null}
            options={clients.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => setClientId(v ? String(v) : '')}
            placeholder="Выбрать клиента…"
            disabled={locked}
          />
        </div>
        <div>
          <label style={labelStyle}>Количество, шт. <span style={{ fontWeight: 400, color: 'var(--c-text-subtle)' }}>· не обязательно</span></label>
          <input className="input" inputMode="numeric" placeholder="например, 300" value={qty} disabled={locked}
            onChange={(e) => {
              setQty(e.target.value)
              if (!e.target.value.trim()) setPerUnit(false)
            }} />
        </div>
        <div>
          <label style={labelStyle}>{perUnit ? 'Цена за шт., ₽' : 'Сумма итого, ₽'}</label>
          <input className="input" inputMode="decimal" placeholder={perUnit ? 'например, 15' : 'например, 4500'} value={amount} disabled={locked}
            onChange={(e) => setAmount(e.target.value)} />
        </div>
        {!locked && (
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, marginTop: -4 }}>
            <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Ввод стоимости:</span>
            <button type="button" className={`chip${!perUnit ? ' active' : ''}`} onClick={() => setPerUnit(false)}>итого</button>
            <button type="button" className={`chip${perUnit ? ' active' : ''}`} disabled={!qtyValid}
              title={!qtyValid ? 'Сначала укажите количество' : undefined}
              style={!qtyValid ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              onClick={() => { if (qtyValid) setPerUnit(true) }}>за единицу</button>
          </div>
        )}
        {qtyValid && kopecks != null && kopecks > 0 && (
          <div style={{ gridColumn: '1 / -1', fontSize: 12.5, color: 'var(--c-text-muted)', marginTop: -4 }}>
            {perUnit
              ? <>{qtyNum} шт. × {formatMoneyKopecks(kopecks)} = <b>{formatMoneyKopecks(totalKop)}</b> итого</>
              : <>{formatMoneyKopecks(kopecks)} ÷ {qtyNum} шт. ≈ <b>{formatMoneyKopecks(Math.round(kopecks / qtyNum))}</b>/шт.</>}
          </div>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Комментарий</label>
          <textarea className="input" rows={2} placeholder="Что делали и почему…" value={comment} disabled={locked}
            onChange={(e) => setComment(e.target.value)} style={{ resize: 'vertical' }} />
        </div>
      </div>
    </Modal>
  )
}
