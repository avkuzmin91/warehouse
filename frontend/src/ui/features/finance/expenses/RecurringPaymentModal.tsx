import { useMemo, useState } from 'react'
import { getRecurringOutstanding, payRecurring } from '../../../../api/recurringExpensesApi'
import type { ExpenseDictItem } from '../../../../api/expensesApi'
import { Modal } from '../../../feedback/Modal'
import { Combobox } from '../../../data/Combobox'
import { DatePicker } from '../../../primitives/DatePicker'
import { Icon } from '../../../primitives/Icon'
import { useApi } from '../../../../hooks/useApi'
import { useToast } from '../../../feedback/Toast'
import { formatMoneyKopecks, localTodayYmd, parseRublesToKopecks } from '../../../../utils/format'

/** Массовая оплата по регулярному расходу: сумма распределяется по его начислениям
 *  от ранних к поздним (FIFO). Сумму нельзя ввести больше суммарного остатка. */
export function RecurringPaymentModal({ paymentSources, onClose, onPaid }: {
  paymentSources: ExpenseDictItem[]
  onClose: () => void
  onPaid: () => void
}) {
  const toast = useToast()
  const { data: templates, loading } = useApi((s) => getRecurringOutstanding(s), [])

  const [templateId, setTemplateId] = useState('')
  const [amount, setAmount] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [paidOn, setPaidOn] = useState(localTodayYmd())
  const [busy, setBusy] = useState(false)

  const list = templates ?? []
  const selected = useMemo(() => list.find((t) => t.template_id === templateId) ?? null, [list, templateId])
  const debt = selected?.outstanding_amount ?? 0
  const kopecks = parseRublesToKopecks(amount)
  const overDebt = kopecks != null && selected != null && kopecks > debt

  const blockReasons: string[] = [
    ...(!templateId ? ['Выберите расход'] : []),
    ...(kopecks == null || kopecks <= 0 ? ['Сумма — число больше нуля'] : []),
    ...(overDebt ? [`Сумма больше остатка (${formatMoneyKopecks(debt)})`] : []),
    ...(!sourceId ? ['Выберите источник оплаты'] : []),
  ]

  function submit() {
    if (blockReasons.length) { toast(blockReasons[0], 'error'); return }
    setBusy(true)
    payRecurring({ template_id: templateId, amount: kopecks as number, payment_source_id: sourceId, paid_on: paidOn })
      .then((r) => {
        const parts = [`закрыто полностью: ${r.fully_paid_count}`]
        if (r.partially_paid_count > 0) parts.push(`частично: ${r.partially_paid_count}`)
        toast(`Оплачено ${formatMoneyKopecks(r.allocated_amount)} · ${parts.join(', ')}`, 'success')
        onPaid()
      })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <Modal
      open onClose={onClose} width={520}
      title="Оплата регулярного расхода"
      subtitle="Сумма распределяется по начислениям от ранних к поздним"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={submit} disabled={busy || loading}>
            <Icon name="wallet" size={14} />{busy ? 'Оплата…' : 'Оплатить'}
          </button>
        </>
      }
    >
      {loading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--c-text-subtle)' }}>Загрузка…</div>
      ) : list.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          Нет регулярных расходов с неоплаченными начислениями.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <FieldLabel>Расход</FieldLabel>
            <Combobox
              value={templateId || null}
              onChange={(v) => setTemplateId(v ? String(v) : '')}
              options={list.map((t) => ({ value: t.template_id, label: `${t.template_name} · долг ${formatMoneyKopecks(t.outstanding_amount)}` }))}
              placeholder="Выберите расход…"
              prefix="forklift"
            />
            {selected && (
              <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 6 }}>
                Остаток: <span className="mono">{formatMoneyKopecks(debt)}</span> · начислений: {selected.count}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <FieldLabel>Сумма оплаты, ₽</FieldLabel>
              <input
                className="input" inputMode="decimal" placeholder="например, 30000"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                style={overDebt ? { borderColor: 'var(--c-danger)', background: 'var(--c-danger-bg)' } : undefined}
              />
              {selected && (
                <button
                  type="button" className="btn ghost sm" style={{ marginTop: 6 }}
                  onClick={() => setAmount(String(Math.round(debt / 100)))}
                >Весь остаток</button>
              )}
            </div>
            <div>
              <FieldLabel>Дата оплаты</FieldLabel>
              <DatePicker value={paidOn} onChange={setPaidOn} />
            </div>
          </div>

          <div>
            <FieldLabel>Источник оплаты</FieldLabel>
            <Combobox
              value={sourceId || null}
              onChange={(v) => setSourceId(v ? String(v) : '')}
              options={paymentSources.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="С чьей карты…"
              prefix="wallet"
            />
          </div>
        </div>
      )}
    </Modal>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 6 }}>{children}</div>
  )
}
