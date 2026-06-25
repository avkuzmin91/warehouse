import { useMemo, useState } from 'react'
import {
  getCarriersOutstanding,
  payCarrier,
} from '../../../../api/expensesApi'
import type { ExpenseDictItem } from '../../../../api/expensesApi'
import { Modal } from '../../../feedback/Modal'
import { Combobox } from '../../../data/Combobox'
import { DatePicker } from '../../../primitives/DatePicker'
import { Icon } from '../../../primitives/Icon'
import { useApi } from '../../../../hooks/useApi'
import { useToast } from '../../../feedback/Toast'
import { formatMoneyKopecks, localTodayYmd, parseRublesToKopecks } from '../../../../utils/format'

/** Массовая оплата перевозчику: сумма распределяется по его логистическим расходам
 *  от ранних к поздним (FIFO). Сумму нельзя ввести больше суммарного долга. */
export function CarrierPaymentModal({ paymentSources, onClose, onPaid }: {
  paymentSources: ExpenseDictItem[]
  onClose: () => void
  onPaid: () => void
}) {
  const toast = useToast()
  const { data: carriers, loading } = useApi((s) => getCarriersOutstanding(s), [])

  const [carrierId, setCarrierId] = useState('')
  const [amount, setAmount] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [paidOn, setPaidOn] = useState(localTodayYmd())
  const [busy, setBusy] = useState(false)

  const list = carriers ?? []
  const selected = useMemo(() => list.find((c) => c.carrier_id === carrierId) ?? null, [list, carrierId])
  const debt = selected?.outstanding_amount ?? 0
  const kopecks = parseRublesToKopecks(amount)
  const overDebt = kopecks != null && selected != null && kopecks > debt

  const blockReasons: string[] = [
    ...(!carrierId ? ['Выберите перевозчика'] : []),
    ...(kopecks == null || kopecks <= 0 ? ['Сумма — число больше нуля'] : []),
    ...(overDebt ? [`Сумма больше долга перевозчику (${formatMoneyKopecks(debt)})`] : []),
    ...(!sourceId ? ['Выберите источник оплаты'] : []),
  ]

  function submit() {
    if (blockReasons.length) { toast(blockReasons[0], 'error'); return }
    setBusy(true)
    payCarrier({ carrier_id: carrierId, amount: kopecks as number, payment_source_id: sourceId, paid_on: paidOn })
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
      title="Оплата перевозчику"
      subtitle="Сумма распределяется по логистическим расходам от ранних к поздним"
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
          Нет перевозчиков с неоплаченной логистикой.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <FieldLabel>Перевозчик</FieldLabel>
            <Combobox
              value={carrierId || null}
              onChange={(v) => setCarrierId(v ? String(v) : '')}
              options={list.map((c) => ({ value: c.carrier_id, label: `${c.carrier_name} · долг ${formatMoneyKopecks(c.outstanding_amount)}` }))}
              placeholder="Выберите перевозчика…"
              prefix="truckIn"
            />
            {selected && (
              <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginTop: 6 }}>
                Долг: <span className="mono">{formatMoneyKopecks(debt)}</span> · расходов: {selected.count}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <FieldLabel>Сумма оплаты, ₽</FieldLabel>
              <input
                className="input" inputMode="decimal" placeholder="например, 50000"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                style={overDebt ? { borderColor: 'var(--c-danger)', background: 'var(--c-danger-bg)' } : undefined}
              />
              {selected && (
                <button
                  type="button" className="btn ghost sm" style={{ marginTop: 6 }}
                  onClick={() => setAmount(String(Math.round(debt / 100)))}
                >Весь долг</button>
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
