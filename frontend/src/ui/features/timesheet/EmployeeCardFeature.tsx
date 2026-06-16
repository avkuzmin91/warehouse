import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useToast } from '../../feedback/Toast'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { canViewPayroll } from '../../../utils/access'
import { EmpAvatar, Badge, PayTypeBadge, fmtMoney, fmtHours, fmtRate } from './shared'
import { AdvanceModal, RateModal, EditEmployeeModal } from './modals'
import { getEmployee, archiveEmployee, restoreEmployee, type EmployeeDetail, type RateHistoryItem } from '../../../api/timesheetApi'

function SumCell({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: 'accent' | 'danger' }) {
  const col = tone === 'accent' ? 'var(--c-accent-text)' : tone === 'danger' ? 'var(--c-danger)' : 'var(--c-text)'
  return (
    <div style={{ padding: '14px 16px', borderLeft: '1px solid var(--c-border)', ...(tone === 'accent' ? { background: 'var(--c-accent-bg)' } : {}) }}>
      <div style={{ fontSize: 11.5, color: tone === 'accent' ? 'var(--c-accent-text)' : 'var(--c-text-subtle)', marginBottom: 4 }}>{label}</div>
      <div className="mono" style={{ fontSize: big ? 20 : 16, fontWeight: big ? 700 : 600, letterSpacing: '-0.01em', color: col }}>{value}</div>
    </div>
  )
}

function Panel({ icon, title, right, children, bodyPad = true }: { icon: string; title: string; right?: React.ReactNode; children: React.ReactNode; bodyPad?: boolean }) {
  return (
    <div className="card">
      <div className="card-head">
        <Icon name={icon as never} size={15} style={{ color: 'var(--c-accent)' }} />
        <span className="card-head-title">{title}</span>
        {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
      </div>
      <div style={{ padding: bodyPad ? 14 : 0 }}>{children}</div>
    </div>
  )
}

function RateTimeline({ history }: { history: RateHistoryItem[] }) {
  return (
    <div style={{ padding: 2 }}>
      {history.map((r, i) => {
        const last = i === history.length - 1
        return (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22 }}>
              <div style={{ width: 22, height: 22, borderRadius: 99, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: r.current ? 'var(--c-accent)' : 'var(--c-bg-elev)', border: r.current ? '1.5px solid var(--c-accent)' : '1.5px solid var(--c-border-strong)', color: r.current ? '#fff' : 'var(--c-text-faint)' }}>
                <Icon name={r.current ? 'ruble' : 'history'} size={11} />
              </div>
              {!last && <div style={{ width: 2, flex: 1, minHeight: 22, background: 'var(--c-border)' }} />}
            </div>
            <div style={{ paddingBottom: last ? 0 : 16, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: r.current ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{fmtRate(r.rate_kopecks)}</span>
                {r.current && <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-accent)' }}>сейчас</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                <Icon name="calendar" size={11} />действует с {r.effective_from}
                {r.note && <span style={{ color: 'var(--c-text-faint)' }}>· {r.note}</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function EmployeeCardFeature({ empId }: { empId: string }) {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const showMoney = canViewPayroll(user)
  const toast = useToast()
  const confirm = useConfirm()
  const [tick, setTick] = useState(0)
  const [advance, setAdvance] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const { data: e, loading, error } = useApi<EmployeeDetail>(
    (signal) => getEmployee(empId, signal),
    [empId, tick],
  )
  const reload = () => setTick((t) => t + 1)

  const onArchive = async () => {
    if (!e) return
    const ok = await confirm({
      title: 'Перевести в архив?',
      body: `${e.full_name} перестанет предлагаться при планировании и вводе факта. История смен, ставок и выплат сохранится — архив можно отменить.`,
      danger: true, confirmLabel: 'В архив',
    })
    if (!ok) return
    try { await archiveEmployee(empId); toast('Сотрудник в архиве', 'success'); reload() }
    catch (err) { toast(err instanceof Error ? err.message : 'Ошибка', 'error') }
  }
  const onRestore = async () => {
    try { await restoreEmployee(empId); toast('Восстановлен', 'success'); reload() }
    catch (err) { toast(err instanceof Error ? err.message : 'Ошибка', 'error') }
  }

  if (error) return <div className="page"><div className="card" style={{ padding: 16, color: 'var(--c-danger)' }}>{error.message}</div></div>
  if (!e) return <div className="page" style={{ padding: 24, color: 'var(--c-text-subtle)' }}>{loading ? 'Загрузка…' : null}</div>

  const w = e.this_week
  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid var(--c-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn ghost icon sm" onClick={() => navigate('/timesheet/employees')}><Icon name="arrowLeft" size={14} /></button>
          <EmpAvatar name={e.full_name} size={44} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>{e.full_name}</span>
              {e.status === 'archived' ? <Badge>В архиве</Badge> : <Badge tone="success" dot>Активен</Badge>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, fontSize: 13, color: 'var(--c-text-muted)' }}>
              <Icon name="briefcase" size={13} style={{ color: 'var(--c-text-subtle)' }} />{e.position ?? '—'}
              {showMoney && e.rate_kopecks != null && <><span style={{ color: 'var(--c-text-faint)' }}>·</span><span className="mono" style={{ fontWeight: 600, color: 'var(--c-text)' }}>{fmtRate(e.rate_kopecks)}</span></>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {showMoney && e.status === 'active' && <button className="btn primary" onClick={() => setAdvance(true)}><Icon name="banknote" size={14} />Выдать аванс</button>}
          {e.status === 'active' && <button className="btn" onClick={() => setEditOpen(true)}><Icon name="edit" size={14} />Изменить</button>}
          {e.status === 'active'
            ? <button className="btn" onClick={onArchive}><Icon name="archive" size={14} />В архив</button>
            : <button className="btn" onClick={onRestore}><Icon name="history" size={14} />Восстановить</button>}
        </div>
      </div>

      <div className="split">
        <div className="col" style={{ gap: 14 }}>
          <Panel icon="clock" title="Эта неделя" bodyPad={false} right={<span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>{e.week_label}</span>}>
            <div style={{ display: 'grid', gridTemplateColumns: showMoney ? 'repeat(4, 1fr)' : 'repeat(2, 1fr)' }}>
              <SumCell label="Отработано" value={fmtHours(w.hours)} />
              <SumCell label="Смен" value={`${w.worked_days}${w.absent ? ` · ${w.absent} невых.` : ''}`} tone={w.absent ? 'danger' : undefined} />
              {showMoney && <SumCell label="Заработано" value={fmtMoney(w.earned)} />}
              {showMoney && <SumCell label="К выдаче" value={fmtMoney(w.to_pay)} big tone="accent" />}
            </div>
          </Panel>

          {showMoney && (
            <Panel icon="wallet" title="История выплат" bodyPad={false}>
              {e.pay_history.length ? (
                <table className="t" style={{ width: '100%' }}>
                  <tbody>
                    {e.pay_history.map((p) => (
                      <tr key={p.id}>
                        <td style={{ width: 110, paddingLeft: 14 }}><PayTypeBadge kind={p.kind} label={p.kind_label} /></td>
                        <td className="num" style={{ fontWeight: 600 }}>{fmtMoney(p.amount_kopecks)}</td>
                        <td><span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>{p.period_start ? `${p.period_start} — ${p.period_end}` : ''}</span></td>
                        <td style={{ width: 120 }}><span className="mono" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>{p.paid_on ?? ''}</span></td>
                        <td style={{ width: 160, color: 'var(--c-text-subtle)', fontSize: 12 }}>{p.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 12.5 }}>Выплат пока нет</div>
              )}
            </Panel>
          )}
        </div>

        <div className="col" style={{ gap: 14 }}>
          {showMoney ? (
            <Panel icon="ruble" title="История ставки" bodyPad={false} right={e.status === 'active' ? <button className="btn ghost sm" onClick={() => setRateOpen(true)}><Icon name="plus" size={13} />Изменить</button> : undefined}>
              <div style={{ padding: '14px 14px 12px' }}>
                {e.rate_history.length ? <RateTimeline history={e.rate_history} /> : <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>Ставка ещё не задана</div>}
              </div>
              <div style={{ padding: '10px 14px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)', fontSize: 11, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="history" size={12} />Прошлые недели считаются по ставке, действовавшей в тот день
              </div>
            </Panel>
          ) : (
            <Panel icon="lock" title="Ставка и выплаты">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 6px', textAlign: 'center' }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-bg-sunken)', color: 'var(--c-text-faint)' }}><Icon name="lock" size={17} /></div>
                <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>Доступно только менеджеру</div>
              </div>
            </Panel>
          )}

          <Panel icon="user" title="Данные">
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}><span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>Должность</span><span style={{ fontSize: 13, fontWeight: 500 }}>{e.position ?? '—'}</span></div>
            {e.user_email && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}><span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>Учётная запись</span><span style={{ fontSize: 12.5 }}>{e.user_email}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}><span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>Статус</span>{e.status === 'archived' ? <Badge>В архиве</Badge> : <Badge tone="success" dot>Активен</Badge>}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}><span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>На складе с</span><span className="mono" style={{ fontSize: 12.5 }}>{e.hired_on ?? '—'}</span></div>
          </Panel>
        </div>
      </div>

      {advance && showMoney && (
        <AdvanceModal
          employeeId={empId} employeeName={e.full_name}
          weekStart={e.week_start} weekEnd={e.week_end}
          earned={w.earned ?? 0} advances={w.advances ?? 0}
          onClose={() => setAdvance(false)} onSaved={reload}
        />
      )}
      {rateOpen && showMoney && (
        <RateModal employeeId={empId} employeeName={e.full_name} onClose={() => setRateOpen(false)} onSaved={reload} />
      )}
      {editOpen && (
        <EditEmployeeModal employee={e} onClose={() => setEditOpen(false)} onSaved={reload} />
      )}
    </div>
  )
}
