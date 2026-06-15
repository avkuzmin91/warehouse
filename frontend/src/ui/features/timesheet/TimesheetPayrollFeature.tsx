import { useState } from 'react'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam } from '../../../hooks/useFilterParams'
import { useToast } from '../../feedback/Toast'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { EmpAvatar, Badge, WeekNavigator, fmtHours, fmtMoney, fmtMoneyShort, fmtRate, addDays } from './shared'
import { SettleModal } from './modals'
import { getPayroll, settleAll, type PayrollResponse, type PayrollRow } from '../../../api/timesheetApi'

function BigNum({ icon, label, value, sub, tone, big }: { icon: string; label: string; value: string; sub?: string; tone?: 'accent' | 'warning'; big?: boolean }) {
  const accent = tone === 'accent'
  const col = accent ? 'var(--c-accent-text)' : tone === 'warning' ? 'var(--c-warning)' : 'var(--c-text)'
  return (
    <div style={{ padding: '14px 16px', borderRadius: 'var(--r-lg)', border: accent ? '1px solid var(--c-accent-border)' : '1px solid var(--c-border)', background: accent ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Icon name={icon as never} size={14} style={{ color: accent ? 'var(--c-accent)' : tone === 'warning' ? 'var(--c-warning)' : 'var(--c-text-subtle)' }} />
        <span style={{ fontSize: 11.5, color: accent ? 'var(--c-accent-text)' : 'var(--c-text-muted)', fontWeight: 500 }}>{label}</span>
      </div>
      <div className="mono" style={{ fontSize: big ? 26 : 20, fontWeight: 700, letterSpacing: '-0.02em', color: col }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? 'var(--c-accent-text)' : 'var(--c-text-subtle)', marginTop: 3, opacity: accent ? 0.8 : 1 }}>{sub}</div>}
    </div>
  )
}

export function TimesheetPayrollFeature() {
  const [week, setWeek] = useFilterParam('week', '')
  const [tick, setTick] = useState(0)
  const [settle, setSettle] = useState<PayrollRow | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const { data, loading, error } = useApi<PayrollResponse>(
    (signal) => getPayroll(week || undefined, signal),
    [week, tick],
  )
  const reload = () => setTick((t) => t + 1)

  const onSettleAll = async () => {
    if (!data) return
    const ok = await confirm({
      title: 'Рассчитать всех?',
      body: `Зафиксируем выплату типа «Расчёт» всем нерассчитанным (${data.totals.left}). Сумма каждому = «к выдаче». Действие записывается в историю.`,
      confirmLabel: 'Рассчитать всех',
    })
    if (!ok) return
    try {
      const r = await settleAll(week || undefined)
      toast(`Рассчитано: ${r.message}`, 'success')
      reload()
    } catch (e) { toast(e instanceof Error ? e.message : 'Ошибка', 'error') }
  }

  return (
    <ListPage
      title="Пятничный расчёт"
      subtitle={data ? `Неделя ${data.week_label} · день выплат — пятница` : 'Загрузка…'}
      actions={
        <>
          <WeekNavigator
            label={data?.week_label ?? '…'}
            onPrev={() => data && setWeek(addDays(data.week_start, -7))}
            onNext={() => data && setWeek(addDays(data.week_start, 7))}
            onToday={() => setWeek('')}
          />
          <button className="btn primary" onClick={onSettleAll} disabled={!data || data.totals.left === 0}>
            <Icon name="check" size={14} />Рассчитать всех{data ? ` (${data.totals.left})` : ''}
          </button>
        </>
      }
    >
      {error && <div className="card" style={{ padding: 16, color: 'var(--c-danger)' }}>{error.message}</div>}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 1fr', gap: 12, marginBottom: 14 }}>
            <BigNum icon="timer" label="Заработано за неделю" value={fmtMoney(data.totals.earned)} sub="по часам × ставка" />
            <BigNum icon="banknote" label="Выдано (авансы)" value={fmtMoney(data.totals.advances)} sub="авансы среди недели" tone="warning" />
            <BigNum icon="wallet" label="К выдаче в пятницу" value={fmtMoney(data.totals.to_pay)} sub="заработано − авансы" tone="accent" big />
            <BigNum icon="userCheck" label="Осталось рассчитать" value={`${data.totals.left} из ${data.totals.employees}`} sub={`${data.totals.employees - data.totals.left} уже закрыто`} />
          </div>

          <div className="t-wrap">
            <table className="t" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>Сотрудник</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Часы</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Заработано</th>
                  <th style={{ width: 150, textAlign: 'right' }}>Выдано (авансы)</th>
                  <th style={{ width: 150, textAlign: 'right', background: 'var(--c-accent-bg)', color: 'var(--c-accent-text)' }}>К выдаче</th>
                  <th style={{ width: 130 }}>Статус</th>
                  <th style={{ width: 130, textAlign: 'right', paddingRight: 14 }}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employee_id} style={r.settled ? { background: 'color-mix(in oklab, var(--c-success) 4%, transparent)' } : undefined}>
                    <td style={{ paddingLeft: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <EmpAvatar name={r.full_name} size={26} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500 }}>{r.full_name}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--c-text-subtle)' }}>{r.position} · {fmtRate(r.rate_kopecks)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">{fmtHours(r.hours)}</td>
                    <td className="num" style={{ fontWeight: 500 }}>{fmtMoney(r.earned)}</td>
                    <td className="num">
                      {r.advances ? <span style={{ color: 'var(--c-warning)', fontWeight: 500 }}>−{fmtMoneyShort(r.advances)} ₽</span> : <span style={{ color: 'var(--c-text-faint)' }}>—</span>}
                    </td>
                    <td className="num" style={{ background: r.settled ? 'color-mix(in oklab, var(--c-success) 7%, transparent)' : 'var(--c-accent-bg)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: r.settled ? 'var(--c-success)' : 'var(--c-accent-text)' }}>{fmtMoney(r.to_pay)}</span>
                        {r.overpaid > 0 && <span style={{ fontSize: 10, color: 'var(--c-danger)' }}>переплата {fmtMoneyShort(r.overpaid)} ₽</span>}
                      </div>
                    </td>
                    <td>
                      {r.settled ? <Badge tone="success" dot>Рассчитан</Badge>
                        : r.overpaid > 0 ? <Badge tone="danger" dot>Переплата</Badge>
                        : <Badge dot>Ожидает</Badge>}
                    </td>
                    <td style={{ textAlign: 'right', paddingRight: 14 }}>
                      {r.settled
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--c-success)' }}><Icon name="check" size={13} />готово</span>
                        : <button className="btn sm primary" onClick={() => setSettle(r)}><Icon name="banknote" size={13} />Рассчитать</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ paddingLeft: 14, fontWeight: 600, background: 'var(--c-bg-active)' }}>Итого по неделе</td>
                  <td className="num" style={{ background: 'var(--c-bg-active)', fontWeight: 600 }}>{fmtHours(data.rows.reduce((a, r) => a + r.hours, 0))}</td>
                  <td className="num" style={{ background: 'var(--c-bg-active)', fontWeight: 700 }}>{fmtMoney(data.totals.earned)}</td>
                  <td className="num" style={{ background: 'var(--c-bg-active)', fontWeight: 600, color: 'var(--c-warning)' }}>−{fmtMoneyShort(data.totals.advances)} ₽</td>
                  <td className="num" style={{ background: 'var(--c-accent)', color: '#fff' }}><span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{fmtMoney(data.totals.to_pay)}</span></td>
                  <td colSpan={2} style={{ background: 'var(--c-bg-active)', textAlign: 'right', paddingRight: 14, fontSize: 12, color: 'var(--c-text-muted)' }}>
                    ещё не рассчитано: <b style={{ color: 'var(--c-text)' }}>{data.totals.left}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="wallet" size={12} />«Рассчитать» фиксирует выплату типа «Расчёт» (сумма по умолчанию = к выдаче, можно скорректировать). Переплата по авансу не уходит в минус.
          </div>
        </>
      )}
      {loading && !data && <div style={{ padding: 24, color: 'var(--c-text-subtle)' }}>Загрузка расчёта…</div>}

      {settle && data && (
        <SettleModal
          employeeId={settle.employee_id}
          employeeName={settle.full_name}
          weekLabel={data.week_label}
          weekStart={data.week_start}
          weekEnd={data.week_end}
          earned={settle.earned}
          advances={settle.advances}
          toPay={settle.to_pay}
          hours={settle.hours}
          rate={settle.rate_kopecks}
          onClose={() => setSettle(null)}
          onSaved={reload}
        />
      )}
    </ListPage>
  )
}
