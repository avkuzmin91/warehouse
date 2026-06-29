import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam } from '../../../hooks/useFilterParams'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canViewPayroll, canViewSalary } from '../../../utils/access'
import { EmpAvatar, Badge, fmtRate } from './shared'
import { AddEmployeeModal } from './modals'
import { getEmployees, type EmployeeListResponse } from '../../../api/timesheetApi'

export function EmployeesListFeature() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const showMoney = canViewPayroll(user)
  const canSetSalary = canViewSalary(user)
  const [search, setSearch] = useFilterParam('search', '')
  const [status, setStatus] = useFilterParam('status', 'active')
  const [tick, setTick] = useState(0)
  const [adding, setAdding] = useState(false)

  const { data, loading, error } = useApi<EmployeeListResponse>(
    (signal) => getEmployees({ status: status || undefined, search: search.trim() || undefined }, signal),
    [status, search, tick],
  )

  const statusTab = (key: string, label: string) => (
    <div className={`chip ${status === key ? 'active' : ''}`} onClick={() => setStatus(key)} style={{ cursor: 'pointer' }}>{label}</div>
  )

  return (
    <ListPage
      title="Сотрудники склада"
      subtitle={data ? `Найдено: ${data.total}` : 'Загрузка…'}
      actions={<button className="btn primary" onClick={() => setAdding(true)}><Icon name="userPlus" size={14} />Добавить сотрудника</button>}
      filters={
        <div className="filters" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="input sm" style={{ minWidth: 240 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ФИО или должность…" />
          {statusTab('active', 'Активные')}
          {statusTab('archived', 'В архиве')}
        </div>
      }
    >
      {error && <div className="card" style={{ padding: 16, color: 'var(--c-danger)' }}>{error.message}</div>}
      <div className="t-wrap">
        <table className="t" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 14 }}>Сотрудник</th>
              <th style={{ width: 180 }}>Должность</th>
              {showMoney && <th style={{ width: 150, textAlign: 'right' }}>Текущая ставка</th>}
              <th style={{ width: 150 }}>Последняя смена</th>
              <th style={{ width: 150 }}>Статус</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((e) => (
              <tr key={e.id} style={{ cursor: 'pointer', ...(e.status === 'archived' ? { opacity: 0.6 } : {}) }} onClick={() => navigate(`/timesheet/employees/${e.id}`)}>
                <td style={{ paddingLeft: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <EmpAvatar name={e.full_name} size={28} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{e.full_name}</span>
                  </div>
                </td>
                <td><span style={{ color: 'var(--c-text-muted)' }}>{e.position ?? '—'}</span></td>
                {showMoney && <td className="num" style={{ fontWeight: 600 }}>{fmtRate(e.rate_kopecks)}</td>}
                <td><span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>{e.last_shift ?? 'нет'}</span></td>
                <td>{e.status === 'archived' ? <Badge>В архиве</Badge> : <Badge tone="success" dot>Активен</Badge>}</td>
                <td><Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} /></td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={showMoney ? 6 : 5} style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-subtle)' }}>Сотрудники не найдены</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && !data && <div style={{ padding: 24, color: 'var(--c-text-subtle)' }}>Загрузка…</div>}

      {adding && <AddEmployeeModal canSetRate={showMoney} canSetSalary={canSetSalary} onClose={() => setAdding(false)} onSaved={() => setTick((t) => t + 1)} />}
    </ListPage>
  )
}
