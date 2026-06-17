import { Modal } from '../../../feedback/Modal'
import { Icon } from '../../../primitives/Icon'
import { formatMoneyKopecks } from '../../../../utils/format'
import type { EmployeeListItem } from '../../../../api/timesheetApi'

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

/** Все сотрудники с фиксированным окладом + суммарный месячный фонд по ним. */
export function SalaryRosterModal({ employees, onClose }: {
  employees: EmployeeListItem[]
  onClose: () => void
}) {
  const fixed = employees
    .filter((e) => e.comp_type === 'fixed')
    .sort((a, b) => (b.fixed_salary_kopecks ?? 0) - (a.fixed_salary_kopecks ?? 0))
  const monthlyTotal = fixed.reduce((sum, e) => sum + (e.fixed_salary_kopecks ?? 0), 0)

  return (
    <Modal
      open onClose={onClose} width={520}
      title="Сотрудники на окладе"
      subtitle={`Фиксированная ЗП · ${fixed.length} ${plural(fixed.length, 'сотрудник', 'сотрудника', 'сотрудников')}`}
    >
      {fixed.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--c-text-subtle)' }}>
          Сотрудников на окладе нет. Оклад задаётся в карточке сотрудника в разделе «Табель».
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {fixed.map((e, i) => (
            <div
              key={e.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
                borderBottom: i < fixed.length - 1 ? '1px solid var(--c-border)' : 'none',
              }}
            >
              <Icon name="user" size={14} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.full_name}</div>
                {e.position && <div className="t-sub">{e.position}</div>}
              </div>
              {e.fixed_salary_kopecks && e.fixed_salary_kopecks > 0 ? (
                <span className="num" style={{ fontWeight: 600, fontSize: 13.5 }}>{formatMoneyKopecks(e.fixed_salary_kopecks)}</span>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>оклад не задан</span>
              )}
            </div>
          ))}
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginTop: 12, paddingTop: 12, borderTop: '2px solid var(--c-border-strong)',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Итого в месяц</span>
            <span className="num" style={{ fontWeight: 700, fontSize: 15 }}>{formatMoneyKopecks(monthlyTotal)}</span>
          </div>
        </div>
      )}
    </Modal>
  )
}
