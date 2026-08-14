import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam } from '../../../hooks/useFilterParams'
import {
  EmpIdentity, MiniStat, OvertimeChip, WeekNavigator, CELL_TONE,
  fmtHours, fmtMoney, fmtMoneyShort, fmtOvertimeHours, addDays,
} from './shared'
import { DayCardDrawer } from './DayCardDrawer'
import { DayFactDrawer } from './DayFactDrawer'
import { getTimesheetWeek, type WeekCell, type WeekDayMeta, type WeekResponse } from '../../../api/timesheetApi'

function DayCellView({ cell, day, onClick }: { cell: WeekCell; day: WeekDayMeta; onClick: () => void }) {
  const st = cell.status
  const tn = CELL_TONE[st]

  if (st === 'off') {
    return (
      <td onClick={onClick} style={{ padding: 0, borderLeft: '1px solid var(--c-border)', background: day.weekend ? 'var(--c-bg-sunken)' : undefined, cursor: 'pointer' }}>
        <div style={{ minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-faint)', fontSize: 11.5 }}>
          {day.weekend ? 'выходной' : '—'}
        </div>
      </td>
    )
  }
  return (
    <td onClick={onClick} style={{ padding: 0, borderLeft: '1px solid var(--c-border)', position: 'relative' }}>
      <div style={{ minHeight: 56, padding: '6px 8px 6px 10px', background: tn.bg, position: 'relative', cursor: 'pointer' }}>
        <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: 2, background: tn.line }} />
        <div style={{ fontSize: 10, color: 'var(--c-text-faint)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, letterSpacing: '0.02em' }}>ПЛАН</span>
          <span className="mono">{cell.planned_start ? `${cell.planned_start}–${cell.planned_end}` : 'нет'}</span>
        </div>
        {st === 'absent' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--c-danger)', fontSize: 12, fontWeight: 600 }}>
            <Icon name="userX" size={12} />Не вышел
          </div>
        ) : st === 'not_called' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--c-text-muted)', fontSize: 12, fontWeight: 600 }}>
            <Icon name="pause" size={12} />Не вызван
          </div>
        ) : st === 'planned' ? (
          <div style={{ fontSize: 12, color: 'var(--c-info)', fontWeight: 500 }}>ждём факт</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: st === 'noplan' ? 'var(--c-warning)' : 'var(--c-text)' }}>
              {cell.actual_start}–{cell.actual_end}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              {cell.overtime_hours > 0 && (
                <OvertimeChip
                  hours={cell.overtime_hours}
                  title={`Переработка ${fmtOvertimeHours(cell.overtime_hours)} сверх 12 ч на смене`}
                />
              )}
              <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: st === 'noplan' ? 'var(--c-warning)' : 'var(--c-success)', background: st === 'noplan' ? 'var(--c-warning-bg)' : 'var(--c-success-bg)', padding: '0 5px', borderRadius: 4 }}>
                {cell.hours.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </span>
            </span>
          </div>
        )}
        {cell.note && st !== 'planned' && (
          <div style={{ fontSize: 10, color: 'var(--c-text-subtle)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cell.note}
          </div>
        )}
      </div>
    </td>
  )
}

export function TimesheetWeekFeature() {
  const navigate = useNavigate()
  const [week, setWeek] = useFilterParam('week', '')
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState<{ employeeId: string; name: string; date: string } | null>(null)
  const [factDate, setFactDate] = useState<string | null>(null)

  const { data, loading, error } = useApi<WeekResponse>(
    (signal) => getTimesheetWeek(week || undefined, signal),
    [week, tick],
  )

  const reload = () => setTick((t) => t + 1)
  const showMoney = data?.with_money ?? false

  /** День по умолчанию для быстрого ввода факта: сегодня, если попадает в неделю; иначе её край. */
  const openDayFact = () => {
    if (!data) return
    const { week_start, week_end, today } = data
    setFactDate(today >= week_start && today <= week_end ? today : today > week_end ? week_end : week_start)
  }

  const legend: { key: keyof typeof CELL_TONE; label: string }[] = [
    { key: 'worked', label: 'Отработал' }, { key: 'planned', label: 'Запланирован' },
    { key: 'absent', label: 'Не вышел' }, { key: 'noplan', label: 'Без плана' },
    { key: 'not_called', label: 'Не вызван' }, { key: 'off', label: 'Выходной' },
  ]

  return (
    <ListPage
      title="Табель учёта времени"
      subtitle={data ? `Расчётная неделя ${data.week_label} · ${data.totals.employees} сотрудников` : 'Загрузка…'}
      actions={
        <>
          <WeekNavigator
            label={data?.week_label ?? '…'}
            onPrev={() => data && setWeek(addDays(data.week_start, -7))}
            onNext={() => data && setWeek(addDays(data.week_start, 7))}
          />
          <button className="btn primary" onClick={openDayFact} disabled={!data}>
            <Icon name="timer" size={14} />Внести факт за день
          </button>
        </>
      }
    >
      {error && <div className="card" style={{ padding: 16, color: 'var(--c-danger)' }}>{error.message}</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <MiniStat icon="users" label="Сотрудников" value={String(data.totals.employees)} />
            <MiniStat icon="timer" label="Отработано за неделю" value={fmtHours(data.totals.hours)} />
            <MiniStat icon="userX" label="Невыходов" value={String(data.totals.absent)} tone={data.totals.absent ? 'danger' : undefined} />
            <MiniStat
              icon="zap"
              label="Переработка"
              value={data.totals.overtime_hours > 0
                ? `${fmtOvertimeHours(data.totals.overtime_hours)}${showMoney && data.totals.overtime_pay ? ` · +${fmtMoneyShort(data.totals.overtime_pay)} ₽` : ''}`
                : 'нет'}
              muted={data.totals.overtime_hours === 0}
            />
            {showMoney
              ? <MiniStat icon="wallet" label="Заработано за неделю" value={fmtMoney(data.totals.earned)} tone="accent" />
              : <MiniStat icon="lock" label="Суммы" value="скрыты для роли" muted />}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--c-text-muted)', marginBottom: 10 }}>
            {legend.map((l) => (
              <span key={l.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: l.key === 'off' ? 'var(--c-text-faint)' : CELL_TONE[l.key].line }} />
                {l.label}
              </span>
            ))}
          </div>

          <div className="t-wrap t-sticky" style={{ overflow: 'clip' }}>
            <table className="t" style={{ width: '100%', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 40 }} />
                <col style={{ width: 210 }} />
                {data.days.map((d) => <col key={d.date} />)}
                <col style={{ width: showMoney ? 168 : 120 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 12, textAlign: 'center', color: 'var(--c-text-faint)' }}>№</th>
                  <th style={{ paddingLeft: 4 }}>Сотрудник</th>
                  {data.days.map((d) => (
                    <th key={d.date} onClick={() => setFactDate(d.date)} title="Внести факт за день" style={{ textAlign: 'center', borderLeft: '1px solid var(--c-border)', cursor: 'pointer', background: d.is_today ? 'var(--c-accent-bg)' : d.weekend ? 'var(--c-bg-active)' : undefined, color: d.is_today ? 'var(--c-accent-text)' : undefined }}>
                      <div style={{ fontWeight: 700, fontSize: 11.5 }}>{d.dow}</div>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 500, opacity: 0.8, marginTop: 1 }}>{d.dom}</div>
                    </th>
                  ))}
                  <th style={{ textAlign: 'right', borderLeft: '1px solid var(--c-border-strong)', background: 'var(--c-bg-active)' }}>Итог недели</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, rowIdx) => (
                  <tr key={row.employee_id}>
                    <td className="mono" style={{ paddingLeft: 12, textAlign: 'center', color: 'var(--c-text-faint)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{rowIdx + 1}</td>
                    <td className="emp-cell" style={{ paddingLeft: 4 }} title="Открыть карточку сотрудника" onClick={() => navigate(`/timesheet/employees/${row.employee_id}`)}>
                      <EmpIdentity name={row.full_name} archived={row.archived} subtitle={row.position} />
                    </td>
                    {row.cells.map((cell, i) => (
                      <DayCellView
                        key={cell.date}
                        cell={cell}
                        day={data.days[i]}
                        onClick={() => setSelected({ employeeId: row.employee_id, name: row.full_name, date: cell.date })}
                      />
                    ))}
                    <td style={{ borderLeft: '1px solid var(--c-border-strong)', background: 'var(--c-bg-sunken)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                        <span className="mono" style={{ fontSize: 13.5, fontWeight: 700 }}>{fmtHours(row.hours)}</span>
                        {showMoney
                          ? <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-accent-text)' }}>{fmtMoney(row.earned)}</span>
                          : <span style={{ fontSize: 10.5, color: 'var(--c-text-subtle)' }}>{row.worked_days} смен</span>}
                        {row.overtime_hours > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--c-warning)', fontWeight: 600 }}>
                            в т.ч. ⚡ {fmtOvertimeHours(row.overtime_hours)}
                            {showMoney && row.overtime_pay ? ` · +${fmtMoneyShort(row.overtime_pay)} ₽` : ''}
                          </span>
                        )}
                        {row.absent > 0 && <span style={{ fontSize: 10, color: 'var(--c-danger)' }}>{row.absent} невыход{row.absent > 1 ? 'а' : ''}</span>}
                        {row.fact_locked && (
                          <span style={{ fontSize: 10, color: 'var(--c-text-subtle)', display: 'inline-flex', alignItems: 'center', gap: 3 }} title="По этой неделе проведён расчёт — факт не изменить">
                            <Icon name="lock" size={10} />расчёт проведён
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ paddingLeft: 14, fontWeight: 600, fontSize: 12, background: 'var(--c-bg-active)' }}>Итого</td>
                  {data.totals.per_day.map((dh, i) => (
                    <td key={data.days[i].date} style={{ borderLeft: '1px solid var(--c-border)', background: 'var(--c-bg-active)', textAlign: 'center' }}>
                      <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: dh ? 'var(--c-text)' : 'var(--c-text-faint)' }}>{dh ? Math.round(dh) : '—'}</span>
                    </td>
                  ))}
                  <td style={{ borderLeft: '1px solid var(--c-border-strong)', background: 'var(--c-bg-active)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <span className="mono" style={{ fontSize: 13.5, fontWeight: 700 }}>{fmtHours(data.totals.hours)}</span>
                      {showMoney && <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-accent-text)' }}>{fmtMoney(data.totals.earned)}</span>}
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="coffee" size={12} />Часы за день = (уход − приход) − 1 ч обед. Свыше 12 ч на смене — переработка: первые 4 ч по ставке +30%, дальше +50%. «Внести факт за день» или клик по дню недели — быстрый ввод по всем сразу; клик по ячейке — карточка дня с журналом.
          </div>
        </>
      )}
      {loading && !data && <div style={{ padding: 24, color: 'var(--c-text-subtle)' }}>Загрузка табеля…</div>}

      {selected && (
        <DayCardDrawer
          employeeId={selected.employeeId}
          employeeName={selected.name}
          workDate={selected.date}
          today={data?.today ?? ''}
          onClose={() => setSelected(null)}
          onSaved={reload}
        />
      )}

      {factDate && data && (() => {
        const idx = data.days.findIndex((d) => d.date === factDate)
        if (idx < 0) return null
        const day = data.days[idx]
        const rows = data.rows.map((r) => ({
          employee_id: r.employee_id,
          full_name: r.full_name,
          position: r.position,
          cell: r.cells[idx],
          locked: r.fact_locked,
        }))
        return (
          <DayFactDrawer
            key={factDate}
            date={factDate}
            dateLabel={`${day.dow}, ${day.date_ru}`}
            rows={rows}
            isFuture={factDate > data.today}
            onClose={() => setFactDate(null)}
            onSaved={reload}
            onPrevDay={idx > 0 ? () => setFactDate(data.days[idx - 1].date) : undefined}
            onNextDay={idx < data.days.length - 1 ? () => setFactDate(data.days[idx + 1].date) : undefined}
          />
        )
      })()}
    </ListPage>
  )
}
