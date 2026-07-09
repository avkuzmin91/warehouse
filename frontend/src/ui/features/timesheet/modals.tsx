import { useEffect, useState } from 'react'
import { Icon } from '../../primitives/Icon'
import { useToast } from '../../feedback/Toast'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canViewSalary } from '../../../utils/access'
import { getUsers } from '../../../api/adminApi'
import type { UserListItem } from '../../../api/domainTypes'
import { ModalShell, FieldLabel, ReadRow, fmtMoney, fmtMoneyShort, fmtRate, fmtHours, rublesToKopecks } from './shared'
import { addPayment, addEmployeeRate, addEmployeeSalary, createEmployee, updateEmployee, type CompType, type EmployeeDetail } from '../../../api/timesheetApi'
import { moscowTodayYmd } from '../../../utils/format'

/** Загружает учётки для связи сотрудника с учётной записью (только для админа). */
function useManageableUsers(enabled: boolean): UserListItem[] {
  const [users, setUsers] = useState<UserListItem[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    getUsers().then((u) => { if (alive) setUsers(u) }).catch(() => {})
    return () => { alive = false }
  }, [enabled])
  return users
}

function todayIso(): string {
  return moscowTodayYmd()
}

const input: React.CSSProperties = { width: '100%', height: 34 }
const lead = (icon: string, tone: string) => (
  <div style={{ width: 34, height: 34, borderRadius: 8, background: `var(--c-${tone}-bg)`, color: `var(--c-${tone})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={icon as never} size={17} />
  </div>
)

// ── Выдать аванс ──────────────────────────────────────────────────────────────

export function AdvanceModal({
  employeeId, employeeName, weekStart, weekEnd, earned, advances, onClose, onSaved,
}: {
  employeeId: string; employeeName: string; weekStart: string; weekEnd: string
  earned: number; advances: number; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState(todayIso())
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const kop = rublesToKopecks(amount)
  const newAdv = advances + kop
  const toPay = Math.max(0, earned - newAdv)

  const submit = async () => {
    if (kop <= 0) { toast('Укажите сумму аванса', 'error'); return }
    setBusy(true)
    try {
      await addPayment({ employee_id: employeeId, amount_kopecks: kop, kind: 'advance', paid_on: paidOn, period_start: weekStart, period_end: weekEnd, comment: comment || null })
      toast('Аванс зафиксирован', 'success')
      onSaved(); onClose()
    } catch (e) { toast(e instanceof Error ? e.message : 'Ошибка', 'error') } finally { setBusy(false) }
  }

  return (
    <ModalShell
      title="Выдать аванс" subtitle={`${employeeName} · среди недели`} lead={lead('banknote', 'warning')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" onClick={submit} disabled={busy}><Icon name="banknote" size={14} />Выдать{kop > 0 ? ` ${fmtMoney(kop)}` : ''}</button></>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div><FieldLabel required>Сумма, ₽</FieldLabel><input className="input sm" style={input} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
        <div><FieldLabel required>Дата</FieldLabel><input className="input sm" type="date" style={input} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <FieldLabel>Комментарий</FieldLabel>
        <input className="input sm" style={input} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Напр. «на проезд», «по просьбе»…" />
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 'var(--r-lg)', background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)' }}>
        <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="wallet" size={12} />Влияние на пятничный расчёт</div>
        <ReadRow label="Заработано (на сейчас)">{fmtMoney(earned)}</ReadRow>
        <ReadRow label="Уже выдано + этот аванс" tone="danger">−{fmtMoneyShort(newAdv)} ₽</ReadRow>
        <div style={{ height: 1, background: 'var(--c-border)', margin: '6px 0' }} />
        <ReadRow label="К выдаче в пятницу">{fmtMoney(toPay)}</ReadRow>
      </div>
    </ModalShell>
  )
}

// ── Рассчитать за неделю ──────────────────────────────────────────────────────

export function SettleModal({
  employeeId, employeeName, weekLabel, weekStart, weekEnd, earned, advances, toPay, hours, rate, onClose, onSaved,
}: {
  employeeId: string; employeeName: string; weekLabel: string; weekStart: string; weekEnd: string
  earned: number; advances: number; toPay: number; hours: number; rate: number | null
  onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [amount, setAmount] = useState(String(Math.round(toPay / 100)))
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const kop = rublesToKopecks(amount)
    if (kop <= 0) { toast('Укажите сумму выплаты', 'error'); return }
    setBusy(true)
    try {
      await addPayment({ employee_id: employeeId, amount_kopecks: kop, kind: 'settlement', paid_on: todayIso(), period_start: weekStart, period_end: weekEnd, comment: comment || 'Пятничный расчёт' })
      toast('Расчёт зафиксирован', 'success')
      onSaved(); onClose()
    } catch (e) { toast(e instanceof Error ? e.message : 'Ошибка', 'error') } finally { setBusy(false) }
  }

  return (
    <ModalShell
      title="Расчёт за неделю" subtitle={`${employeeName} · ${weekLabel}`} lead={lead('wallet', 'accent')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" onClick={submit} disabled={busy}><Icon name="check" size={14} />Рассчитать</button></>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--c-border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '12px 14px', background: 'var(--c-bg-elev)' }}>
          <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>Заработано</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>{fmtMoney(earned)}</div>
          <div style={{ fontSize: 10.5, color: 'var(--c-text-faint)', marginTop: 1 }}>{fmtHours(hours)}{rate != null ? ` × ${fmtRate(rate)}` : ''}</div>
        </div>
        <div style={{ padding: '12px 14px', background: 'var(--c-bg-elev)' }}>
          <div style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>Выдано (авансы)</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 3, color: 'var(--c-warning)' }}>−{fmtMoneyShort(advances)} ₽</div>
        </div>
        <div style={{ padding: '12px 14px', background: 'var(--c-accent-bg)' }}>
          <div style={{ fontSize: 11, color: 'var(--c-accent-text)' }}>К выдаче</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 700, marginTop: 3, color: 'var(--c-accent-text)' }}>{fmtMoney(toPay)}</div>
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <FieldLabel required>Сумма выплаты, ₽</FieldLabel>
        <input className="input sm" style={input} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="help">По умолчанию = к выдаче. Можно скорректировать (например, округлить).</div>
      </div>
      <div>
        <FieldLabel>Комментарий</FieldLabel>
        <input className="input sm" style={input} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Напр. «расчёт за неделю, наличными»…" />
      </div>
    </ModalShell>
  )
}

// ── Изменить ставку ───────────────────────────────────────────────────────────

export function RateModal({
  employeeId, employeeName, onClose, onSaved,
}: { employeeId: string; employeeName: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [rate, setRate] = useState('')
  const [from, setFrom] = useState(todayIso())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const kop = rublesToKopecks(rate)
    if (kop <= 0) { toast('Укажите ставку', 'error'); return }
    if (!from) { toast('Укажите дату действия', 'error'); return }
    setBusy(true)
    try {
      await addEmployeeRate(employeeId, { rate_kopecks: kop, effective_from: from, note: note || null })
      toast('Ставка обновлена', 'success')
      onSaved(); onClose()
    } catch (e) { toast(e instanceof Error ? e.message : 'Ошибка', 'error') } finally { setBusy(false) }
  }

  return (
    <ModalShell
      title="Изменить ставку" subtitle={`${employeeName} · действует с даты`} lead={lead('ruble', 'accent')} width={440} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" onClick={submit} disabled={busy}><Icon name="check" size={14} />Сохранить</button></>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div><FieldLabel required>Ставка, ₽/ч</FieldLabel><input className="input sm" style={input} inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" /></div>
        <div><FieldLabel required>Действует с</FieldLabel><input className="input sm" type="date" style={input} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      </div>
      <div><FieldLabel>Примечание</FieldLabel><input className="input sm" style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр. «индексация»" /></div>
      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--c-text-subtle)', display: 'flex', gap: 6 }}>
        <Icon name="history" size={12} style={{ flexShrink: 0, marginTop: 1 }} />Прошлые недели считаются по ставке, действовавшей в тот день.
      </div>
    </ModalShell>
  )
}

// ── Изменить оклад ─────────────────────────────────────────────────────────────

export function SalaryModal({
  employeeId, employeeName, onClose, onSaved,
}: { employeeId: string; employeeName: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [salary, setSalary] = useState('')
  const [from, setFrom] = useState(todayIso())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const kop = rublesToKopecks(salary)
    if (kop <= 0) { toast('Укажите оклад', 'error'); return }
    if (!from) { toast('Укажите дату действия', 'error'); return }
    setBusy(true)
    try {
      await addEmployeeSalary(employeeId, { salary_kopecks: kop, effective_from: from, note: note || null })
      toast('Оклад обновлён', 'success')
      onSaved(); onClose()
    } catch (e) { toast(e instanceof Error ? e.message : 'Ошибка', 'error') } finally { setBusy(false) }
  }

  return (
    <ModalShell
      title="Изменить оклад" subtitle={`${employeeName} · действует с даты`} lead={lead('ruble', 'accent')} width={440} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" onClick={submit} disabled={busy}><Icon name="check" size={14} />Сохранить</button></>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div><FieldLabel required>Оклад, ₽/мес</FieldLabel><input className="input sm" style={input} inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0" /></div>
        <div><FieldLabel required>Действует с</FieldLabel><input className="input sm" type="date" style={input} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      </div>
      <div><FieldLabel>Примечание</FieldLabel><input className="input sm" style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр. «индексация»" /></div>
      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--c-text-subtle)', display: 'flex', gap: 6 }}>
        <Icon name="history" size={12} style={{ flexShrink: 0, marginTop: 1 }} />Дни до даты начала оклада не начисляются; прошлые месяцы считаются по окладу, действовавшему тогда.
      </div>
    </ModalShell>
  )
}

// ── Добавить сотрудника ───────────────────────────────────────────────────────

export function AddEmployeeModal({
  canSetRate, canSetSalary, onClose, onSaved,
}: { canSetRate: boolean; canSetSalary: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { positions } = useLookups()
  const { user } = useCurrentUser()
  // Привязка сотрудника табеля к учётке — только админ (не совпадает с ведением
  // ролей пользователей, которое доступно и менеджеру).
  const isAdmin = user?.role === 'admin'
  const users = useManageableUsers(isAdmin)
  const [name, setName] = useState('')
  const [positionId, setPositionId] = useState('')
  const [userId, setUserId] = useState('')
  const [rate, setRate] = useState('')
  const [compType, setCompType] = useState<CompType>('hourly')
  const [fixedSalary, setFixedSalary] = useState('')
  const [salaryFrom, setSalaryFrom] = useState(todayIso())
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) { toast('Укажите ФИО', 'error'); return }
    setBusy(true)
    try {
      await createEmployee({
        full_name: name.trim(),
        position_id: positionId || null,
        user_id: isAdmin ? (userId || null) : undefined,
        rate_kopecks: canSetRate && compType === 'hourly' && rate ? rublesToKopecks(rate) : null,
        ...(canSetSalary ? {
          comp_type: compType,
          fixed_salary_kopecks: compType === 'fixed' && fixedSalary ? rublesToKopecks(fixedSalary) : null,
          salary_from: compType === 'fixed' ? salaryFrom : undefined,
        } : {}),
      })
      toast('Сотрудник добавлен', 'success')
      onSaved(); onClose()
    } catch (e) { toast(e instanceof Error ? e.message : 'Ошибка', 'error') } finally { setBusy(false) }
  }

  return (
    <ModalShell
      title="Добавить сотрудника" subtitle="Новый сотрудник склада" lead={lead('userPlus', 'info')} width={460} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" onClick={submit} disabled={busy}><Icon name="check" size={14} />Добавить</button></>}
    >
      <div style={{ marginBottom: 14 }}><FieldLabel required>ФИО</FieldLabel><input className="input sm" style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Фамилия Имя Отчество" /></div>
      <div style={{ display: 'grid', gridTemplateColumns: canSetRate ? '1fr 1fr' : '1fr', gap: 14 }}>
        <div>
          <FieldLabel>Должность</FieldLabel>
          <select className="input sm" style={input} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">— не выбрана —</option>
            {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        {canSetSalary && (
          <div>
            <FieldLabel>Тип оплаты</FieldLabel>
            <select className="input sm" style={input} value={compType} onChange={(e) => setCompType(e.target.value as CompType)}>
              <option value="hourly">Почасовая</option>
              <option value="fixed">Оклад (фикс)</option>
            </select>
          </div>
        )}
        {canSetRate && compType === 'hourly' && <div><FieldLabel>Ставка, ₽/ч</FieldLabel><input className="input sm" style={input} inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" /></div>}
        {canSetSalary && compType === 'fixed' && <div><FieldLabel>Оклад, ₽/мес</FieldLabel><input className="input sm" style={input} inputMode="numeric" value={fixedSalary} onChange={(e) => setFixedSalary(e.target.value)} placeholder="0" /></div>}
        {canSetSalary && compType === 'fixed' && <div><FieldLabel>Оклад с</FieldLabel><input className="input sm" type="date" style={input} value={salaryFrom} onChange={(e) => setSalaryFrom(e.target.value)} /></div>}
      </div>
      {isAdmin && (
        <div style={{ marginTop: 14 }}>
          <FieldLabel>Учётная запись</FieldLabel>
          <select className="input sm" style={input} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— нет —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>
        </div>
      )}
    </ModalShell>
  )
}

// ── Изменить сотрудника (должность / учётка) ──────────────────────────────────

export function EditEmployeeModal({
  employee, onClose, onSaved,
}: { employee: EmployeeDetail; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const { positions } = useLookups()
  const { user } = useCurrentUser()
  // Привязка сотрудника табеля к учётке — только админ (не совпадает с ведением
  // ролей пользователей, которое доступно и менеджеру).
  const isAdmin = user?.role === 'admin'
  const users = useManageableUsers(isAdmin)
  const [name, setName] = useState(employee.full_name)
  const [positionId, setPositionId] = useState(employee.position_id ?? '')
  const [userId, setUserId] = useState(employee.user_id ?? '')
  const [hiredOn, setHiredOn] = useState(employee.hired_on ?? '')
  const [compType, setCompType] = useState<CompType>(employee.comp_type ?? 'hourly')
  const [busy, setBusy] = useState(false)
  // Тип оплаты и оклад в месяц правит только админ (менеджер окладов не ведёт).
  const canSetSalary = canViewSalary(user)

  const submit = async () => {
    if (!name.trim()) { toast('Укажите ФИО', 'error'); return }
    setBusy(true)
    try {
      await updateEmployee(employee.id, {
        full_name: name.trim(),
        position_id: positionId || null,
        hired_on: hiredOn || null,
        user_id: isAdmin ? (userId || null) : undefined,
        ...(canSetSalary ? { comp_type: compType } : {}),
      })
      toast('Сохранено', 'success')
      onSaved(); onClose()
    } catch (e) { toast(e instanceof Error ? e.message : 'Ошибка', 'error') } finally { setBusy(false) }
  }

  return (
    <ModalShell
      title="Изменить сотрудника" subtitle={employee.full_name} lead={lead('user', 'info')} width={460} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" onClick={submit} disabled={busy}><Icon name="check" size={14} />Сохранить</button></>}
    >
      <div style={{ marginBottom: 14 }}><FieldLabel required>ФИО</FieldLabel><input className="input sm" style={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <FieldLabel>Должность</FieldLabel>
          <select className="input sm" style={input} value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">— не выбрана —</option>
            {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><FieldLabel>На складе с</FieldLabel><input className="input sm" type="date" style={input} value={hiredOn} onChange={(e) => setHiredOn(e.target.value)} /></div>
      </div>
      {canSetSalary && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <div>
            <FieldLabel>Тип оплаты</FieldLabel>
            <select className="input sm" style={input} value={compType} onChange={(e) => setCompType(e.target.value as CompType)}>
              <option value="hourly">Почасовая</option>
              <option value="fixed">Оклад (фикс)</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', fontSize: 11, color: 'var(--c-text-subtle)' }}>
            {compType === 'fixed' ? 'Оклад ₽/мес — в блоке «Оклад» карточки' : 'Ставка ₽/ч — в блоке «Ставка» карточки'}
          </div>
          {compType === 'fixed' && (
            <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--c-text-subtle)', display: 'flex', gap: 6 }}>
              <Icon name="calendar" size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              Оклад начисляется автоматически 1-го числа одной проводкой за месяц (в «Финансы → Расходы», ожидает оплаты); сумма — по рабочим дням от даты начала оклада.
            </div>
          )}
        </div>
      )}
      {isAdmin && (
        <div style={{ marginTop: 14 }}>
          <FieldLabel>Учётная запись</FieldLabel>
          <select className="input sm" style={input} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— нет —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>
        </div>
      )}
    </ModalShell>
  )
}
