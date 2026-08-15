import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam } from '../../../hooks/useFilterParams'
import { useToast } from '../../feedback/Toast'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { EmpIdentity, Badge, OvertimeChip, WeekNavigator, fmtHours, fmtMoney, fmtMoneyShort, fmtOvertimeHours, fmtRate, addDays } from './shared'
import { SettleModal } from './modals'
import { getPayroll, settleAll, PAYOUT_STATUS_LABELS, PAYOUT_STATUS_TONE, type PayrollResponse, type PayrollRow } from '../../../api/timesheetApi'

function BigNum({ icon, label, value, sub, tone, big, active, onClick }: {
  icon: string; label: string; value: string; sub?: React.ReactNode
  tone?: 'accent' | 'warning'; big?: boolean; active?: boolean; onClick?: () => void
}) {
  const accent = tone === 'accent'
  const col = accent ? 'var(--c-accent-text)' : tone === 'warning' ? 'var(--c-warning)' : 'var(--c-text)'
  return (
    <div
      onClick={onClick}
      style={{
        padding: '14px 16px', borderRadius: 'var(--r-lg)', textAlign: 'left',
        border: `1px solid ${active ? 'var(--c-accent)' : accent ? 'var(--c-accent-border)' : 'var(--c-border)'}`,
        background: accent ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)',
        cursor: onClick ? 'pointer' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Icon name={icon as never} size={14} style={{ color: accent ? 'var(--c-accent)' : tone === 'warning' ? 'var(--c-warning)' : 'var(--c-text-subtle)' }} />
        <span style={{ fontSize: 11.5, color: accent ? 'var(--c-accent-text)' : 'var(--c-text-muted)', fontWeight: 500 }}>{label}</span>
      </div>
      <div className="mono" style={{ fontSize: big ? 26 : 20, fontWeight: 700, letterSpacing: '-0.02em', color: col }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: accent ? 'var(--c-accent-text)' : 'var(--c-text-subtle)', marginTop: 3, opacity: accent ? 0.8 : 1 }}>{sub}</div>}
    </div>
  )
}

/** Доля выданного от заработанного — чтобы частичный расчёт читался с одного взгляда. */
function PaidBar({ paid, earned, tone }: { paid: number; earned: number; tone: string }) {
  const pct = earned > 0 ? Math.min(100, Math.round((paid / earned) * 100)) : 0
  return (
    <div style={{ height: 3, borderRadius: 2, background: 'var(--c-border)', marginTop: 4, width: '100%' }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: tone }} />
    </div>
  )
}

export function TimesheetPayrollFeature() {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [week, setWeek] = useFilterParam('week', '')
  const [onlyLeft, setOnlyLeft] = useFilterParam('left', '')
  const [tick, setTick] = useState(0)
  const [settle, setSettle] = useState<PayrollRow | null>(null)
  const [busyAll, setBusyAll] = useState(false)

  const { data, loading, error } = useApi<PayrollResponse>(
    (signal) => getPayroll(week || undefined, signal),
    [week, tick],
  )
  const reload = () => setTick((t) => t + 1)

  const rows = data ? (onlyLeft ? data.rows.filter((r) => r.to_pay > 0) : data.rows) : []

  const settleRest = async () => {
    if (!data || data.totals.left === 0) return
    const ok = await confirm({
      title: 'Доплатить всем?',
      body: `По ${data.totals.left} сотрудникам будет проведена выплата на ${fmtMoney(data.totals.to_pay)} — остаток по каждому за неделю ${data.week_label}.`,
      confirmLabel: 'Доплатить',
    })
    if (!ok) return
    setBusyAll(true)
    try {
      const r = await settleAll(week || undefined)
      toast(`Проведено выплат: ${r.message}`, 'success')
      reload()
    } catch (e) { toast(e instanceof Error ? e.message : 'Ошибка', 'error') } finally { setBusyAll(false) }
  }

  return (
    <ListPage
      title="Пятничный расчёт"
      subtitle={data ? `Неделя ${data.week_label} · день выплат — пятница` : 'Загрузка…'}
      actions={
        <WeekNavigator
          label={data?.week_label ?? '…'}
          onPrev={() => data && setWeek(addDays(data.week_start, -7))}
          onNext={() => data && setWeek(addDays(data.week_start, 7))}
        />
      }
    >
      {error && <div className="card" style={{ padding: 16, color: 'var(--c-danger)' }}>{error.message}</div>}
      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 1fr', gap: 12, marginBottom: 14 }}>
            <BigNum
              icon="timer"
              label="Заработано за неделю"
              value={fmtMoney(data.totals.earned)}
              sub={data.totals.overtime_pay
                ? `по часам × ставка, вкл. переработку ${fmtMoneyShort(data.totals.overtime_pay)} ₽ (${fmtOvertimeHours(data.totals.overtime_hours)})`
                : 'по часам × ставка'}
            />
            <BigNum
              icon="banknote"
              label="Выдано"
              value={fmtMoney(data.totals.paid)}
              tone="warning"
              sub={
                <>
                  {`авансы ${fmtMoneyShort(data.totals.advances)} · расчёты ${fmtMoneyShort(data.totals.settlements)} ₽`}
                  <PaidBar paid={data.totals.paid} earned={data.totals.earned} tone="var(--c-warning)" />
                </>
              }
            />
            <BigNum
              icon="wallet"
              label="Осталось выдать"
              value={fmtMoney(data.totals.to_pay)}
              tone="accent"
              big
              active={!!onlyLeft}
              onClick={() => setOnlyLeft(onlyLeft ? '' : '1')}
              sub={data.totals.left
                ? `по ${data.totals.left} сотрудникам${onlyLeft ? ' · показаны только они' : ' — нажмите, чтобы отфильтровать'}`
                : 'неделя закрыта полностью'}
            />
            <BigNum
              icon="userCheck"
              label="Закрыто полностью"
              value={`${data.totals.employees - data.totals.left} из ${data.totals.employees}`}
              sub={data.totals.partial ? `${data.totals.partial} рассчитаны частично` : `${data.totals.left} ожидают расчёта`}
            />
          </div>

          <div className="t-wrap">
            <table className="t" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>Сотрудник</th>
                  <th style={{ width: 90, textAlign: 'right' }}>Часы</th>
                  <th style={{ width: 140, textAlign: 'right' }}>Заработано</th>
                  <th style={{ width: 160, textAlign: 'right' }}>Выплата</th>
                  <th style={{ width: 150, textAlign: 'right', background: 'var(--c-accent-bg)', color: 'var(--c-accent-text)' }}>Осталось выдать</th>
                  <th style={{ width: 120 }}>Статус</th>
                  <th style={{ width: 190, textAlign: 'right', paddingRight: 14 }}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const paid = r.advances + r.settlements
                  const closed = r.to_pay === 0
                  return (
                    <tr key={r.employee_id} style={closed ? { background: 'color-mix(in oklab, var(--c-success) 4%, transparent)' } : undefined}>
                      <td className="emp-cell" style={{ paddingLeft: 14 }} title="Открыть карточку сотрудника" onClick={() => navigate(`/timesheet/employees/${r.employee_id}`)}>
                        <EmpIdentity name={r.full_name} archived={r.archived} subtitle={<>{r.position} · {fmtRate(r.rate_kopecks)}</>} />
                      </td>
                      <td className="num">
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          <span>{fmtHours(r.hours)}</span>
                          {r.overtime_hours > 0 && (
                            <OvertimeChip hours={r.overtime_hours} title={`Переработка ${fmtOvertimeHours(r.overtime_hours)} сверх 12 ч на смене`} />
                          )}
                        </div>
                      </td>
                      <td className="num" style={{ fontWeight: 500 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          <span>{fmtMoney(r.earned)}</span>
                          {r.overtime_pay > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--c-warning)' }}>вкл. переработку {fmtMoneyShort(r.overtime_pay)} ₽</span>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        {paid ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            <span style={{ color: closed ? 'var(--c-success)' : 'var(--c-warning)', fontWeight: 500 }}>
                              {fmtMoneyShort(paid)} из {fmtMoneyShort(r.earned)}
                            </span>
                            <PaidBar paid={paid} earned={r.earned} tone={closed ? 'var(--c-success)' : 'var(--c-warning)'} />
                            <span style={{ fontSize: 10, color: 'var(--c-text-faint)' }}>
                              {r.advances ? `аванс ${fmtMoneyShort(r.advances)}` : ''}
                              {r.advances && r.settlements ? ' · ' : ''}
                              {r.settlements ? `расчёт ${fmtMoneyShort(r.settlements)}` : ''}
                            </span>
                          </div>
                        ) : <span style={{ color: 'var(--c-text-faint)' }}>—</span>}
                      </td>
                      <td className="num" style={{ background: closed ? 'color-mix(in oklab, var(--c-success) 7%, transparent)' : 'var(--c-accent-bg)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                          <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: closed ? 'var(--c-success)' : 'var(--c-accent-text)' }}>{fmtMoney(r.to_pay)}</span>
                          {r.overpaid > 0 && <span style={{ fontSize: 10, color: 'var(--c-danger)' }}>переплата {fmtMoneyShort(r.overpaid)} ₽</span>}
                        </div>
                      </td>
                      <td>
                        <Badge tone={PAYOUT_STATUS_TONE[r.payout_status]} dot>{PAYOUT_STATUS_LABELS[r.payout_status]}</Badge>
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 14 }}>
                        {r.to_pay > 0
                          ? (
                            <button className="btn sm primary" onClick={() => setSettle(r)}>
                              <Icon name={r.settlements > 0 ? 'plus' : 'banknote'} size={13} />
                              {r.settlements > 0 ? 'Доплатить' : 'Рассчитать'} {fmtMoney(r.to_pay)}
                            </button>
                          )
                          : r.overpaid > 0
                            ? <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>учесть в след. неделе</span>
                            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--c-success)' }}><Icon name="check" size={13} />готово</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ paddingLeft: 14, fontWeight: 600, background: 'var(--c-bg-active)' }}>Итого по неделе</td>
                  <td className="num" style={{ background: 'var(--c-bg-active)', fontWeight: 600 }}>{fmtHours(data.rows.reduce((a, r) => a + r.hours, 0))}</td>
                  <td className="num" style={{ background: 'var(--c-bg-active)', fontWeight: 700 }}>{fmtMoney(data.totals.earned)}</td>
                  <td className="num" style={{ background: 'var(--c-bg-active)', fontWeight: 600, color: 'var(--c-warning)' }}>−{fmtMoneyShort(data.totals.paid)} ₽</td>
                  <td className="num" style={{ background: 'var(--c-accent)', color: 'var(--c-accent-contrast)' }}><span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{fmtMoney(data.totals.to_pay)}</span></td>
                  <td colSpan={2} style={{ background: 'var(--c-bg-active)', textAlign: 'right', paddingRight: 14 }}>
                    {data.totals.left > 0
                      ? (
                        <button className="btn sm" disabled={busyAll} onClick={settleRest}>
                          <Icon name="wallet" size={13} />Доплатить всем · {fmtMoney(data.totals.to_pay)}
                        </button>
                      )
                      : <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>неделя закрыта</span>}
                  </td>
                </tr>
              </tfoot>
            </table>
            {onlyLeft && rows.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                Все строки закрыты — выдавать нечего.
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="wallet" size={12} />Расчёт можно проводить частями: пока остаток не выдан, строка остаётся открытой и сумму можно доплатить. Часы недели запираются только после полного закрытия.
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
          settlements={settle.settlements}
          toPay={settle.to_pay}
          hours={settle.hours}
          rate={settle.rate_kopecks}
          overtimePay={settle.overtime_pay}
          onClose={() => setSettle(null)}
          onSaved={reload}
        />
      )}
    </ListPage>
  )
}
