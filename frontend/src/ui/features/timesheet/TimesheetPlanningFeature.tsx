import { useState } from 'react'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam } from '../../../hooks/useFilterParams'
import { useToast } from '../../feedback/Toast'
import { EmpAvatar, MiniStat, WeekNavigator, addDays, nextWeekStartIso } from './shared'
import { getTimesheetWeek, upsertEntry, bulkPlan, type WeekResponse, type WeekRow, type WeekCell } from '../../../api/timesheetApi'

const STD: [string, string] = ['08:00', '20:00']
const MIN_STAFF = 4

const SHIFT_PRESETS: { label: string; s: string; e: string }[] = [
  { label: 'Весь день', s: '08:00', e: '20:00' },
  { label: 'Первая половина', s: '08:00', e: '14:00' },
  { label: 'Вторая половина', s: '14:00', e: '20:00' },
]

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const addMin = (t: string, delta: number) => {
  const m = Math.max(0, Math.min(24 * 60, toMin(t) + delta))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const grossH = (s: string, e: string) => Math.max(0, (toMin(e) - toMin(s)) / 60)
const isStd = (s: string | null, e: string | null) => s === STD[0] && e === STD[1]
const fmtH = (n: number) => (Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')) + ' ч'

type EditCell = { employeeId: string; date: string }

export function TimesheetPlanningFeature() {
  const [weekParam, setWeekParam] = useFilterParam('week', '')
  const week = weekParam || nextWeekStartIso()
  const [tick, setTick] = useState(0)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditCell | null>(null)
  const toast = useToast()

  const { data, loading, error } = useApi<WeekResponse>(
    (signal) => getTimesheetWeek(week, signal),
    [week, tick],
  )
  const reload = () => setTick((t) => t + 1)

  // Базовый payload сохраняет факт/примечание/невыход — планирование меняет только смену.
  const base = (employeeId: string, cell: WeekCell) => ({
    employee_id: employeeId,
    work_date: cell.date,
    actual_start: cell.actual_start,
    actual_end: cell.actual_end,
    is_absent: cell.status === 'absent',
    note: cell.note,
  })

  const saveCell = async (employeeId: string, cell: WeekCell, start: string | null, end: string | null) => {
    const key = `${employeeId}:${cell.date}`
    setSavingKey(key)
    try {
      await upsertEntry({ ...base(employeeId, cell), planned_start: start, planned_end: end })
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    } finally {
      setSavingKey(null)
    }
  }

  const standardForAll = async () => {
    if (!data) return
    setEditing(null)
    try {
      const ids = data.rows.map((r) => r.employee_id)
      for (const d of data.days) {
        if (d.weekend) continue
        await bulkPlan({ work_date: d.date, employee_ids: ids, planned_start: STD[0], planned_end: STD[1] })
      }
      toast('Стандартный план проставлен', 'success')
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    }
  }

  const standardForEmployee = async (row: WeekRow) => {
    if (!data) return
    setEditing(null)
    setSavingKey(`emp:${row.employee_id}`)
    try {
      for (let i = 0; i < data.days.length; i++) {
        const d = data.days[i]
        const cell = row.cells[i]
        if (d.weekend) {
          if (cell.planned_start) await upsertEntry({ ...base(row.employee_id, cell), planned_start: null, planned_end: null })
          continue
        }
        if (isStd(cell.planned_start, cell.planned_end)) continue
        await upsertEntry({ ...base(row.employee_id, cell), planned_start: STD[0], planned_end: STD[1] })
      }
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    } finally {
      setSavingKey(null)
    }
  }

  const clearForEmployee = async (row: WeekRow) => {
    setEditing(null)
    setSavingKey(`emp:${row.employee_id}`)
    try {
      for (const cell of row.cells) {
        if (cell.planned_start) await upsertEntry({ ...base(row.employee_id, cell), planned_start: null, planned_end: null })
      }
      reload()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    } finally {
      setSavingKey(null)
    }
  }

  const perDay = data ? data.days.map((_, i) => data.rows.filter((r) => r.cells[i].planned_start).length) : []
  const totalShifts = data ? data.rows.reduce((s, r) => s + r.cells.filter((c) => c.planned_start).length, 0) : 0
  const understaffed = data ? data.days.filter((d, i) => !d.weekend && perDay[i] < MIN_STAFF).length : 0
  const planned = data ? data.rows.filter((r) => r.cells.some((c) => c.planned_start)).length : 0
  const customCount = data
    ? data.rows.reduce((s, r) => s + r.cells.filter((c) => c.planned_start && !isStd(c.planned_start, c.planned_end)).length, 0)
    : 0

  return (
    <ListPage
      title="Планирование смен"
      subtitle={data ? `Неделя ${data.week_label} · по умолчанию 08:00–20:00, крестиком уберите выходные, карандашом меняйте часы` : 'Загрузка…'}
      actions={
        <>
          <WeekNavigator
            label={data?.week_label ?? '…'}
            onPrev={() => data && setWeekParam(addDays(data.week_start, -7))}
            onNext={() => data && setWeekParam(addDays(data.week_start, 7))}
            onToday={() => setWeekParam(nextWeekStartIso())}
          />
          <button className="btn" onClick={standardForAll}><Icon name="zap" size={14} />Стандарт всем</button>
        </>
      }
    >
      {error && <div className="card" style={{ padding: 16, color: 'var(--c-danger)' }}>{error.message}</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <MiniStat icon="users" label="Сотрудников в плане" value={`${planned} из ${data.totals.employees}`} />
            <MiniStat icon="calendar" label="Смен за неделю" value={String(totalShifts)} />
            <MiniStat icon="edit" label="Неполных смен" value={customCount ? String(customCount) : 'нет'} tone={customCount ? 'accent' : undefined} />
            <MiniStat icon="userX" label="Дни с нехваткой" value={understaffed ? `${understaffed} дн.` : 'нет'} tone={understaffed ? 'danger' : undefined} />
          </div>

          <div className="t-wrap" style={{ overflow: editing ? 'visible' : 'hidden', position: 'relative' }}>
            <table className="t" style={{ width: '100%', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 250 }} />
                {data.days.map((d) => <col key={d.date} />)}
                <col style={{ width: 96 }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 14 }}>Сотрудник</th>
                  {data.days.map((d) => (
                    <th key={d.date} style={{ textAlign: 'center', borderLeft: '1px solid var(--c-border)', background: d.weekend ? 'var(--c-bg-active)' : undefined }}>
                      <div style={{ fontWeight: 700, fontSize: 11.5 }}>{d.dow}</div>
                      <div className="mono" style={{ fontSize: 11, fontWeight: 500, opacity: 0.8, marginTop: 1 }}>{d.dom}</div>
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', borderLeft: '1px solid var(--c-border-strong)', background: 'var(--c-bg-active)' }}>Смен</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const n = row.cells.filter((c) => c.planned_start).length
                  const empBusy = savingKey === `emp:${row.employee_id}`
                  return (
                    <tr key={row.employee_id}>
                      <td style={{ paddingLeft: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <EmpAvatar name={row.full_name} size={26} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.full_name}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--c-text-subtle)' }}>{row.position}</div>
                          </div>
                          <div className="plan-row-actions" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <button className="btn ghost sm" title="Стандартная неделя 08:00–20:00 этому сотруднику"
                              onClick={() => standardForEmployee(row)} disabled={empBusy} style={{ height: 26, padding: '0 8px' }}>
                              <Icon name="zap" size={12} />Стандарт
                            </button>
                            <button className="btn ghost icon sm" title="Очистить — всю неделю в выходные"
                              onClick={() => clearForEmployee(row)} disabled={empBusy} style={{ width: 26, height: 26 }}>
                              <Icon name="x" size={12} />
                            </button>
                          </div>
                        </div>
                      </td>
                      {row.cells.map((cell, i) => {
                        const d = data.days[i]
                        const key = `${row.employee_id}:${cell.date}`
                        return (
                          <PlanCell
                            key={cell.date}
                            cell={cell}
                            weekend={d.weekend}
                            busy={savingKey === key || empBusy}
                            editing={editing?.employeeId === row.employee_id && editing?.date === cell.date}
                            dayLabel={`${d.dow} ${d.dom}`}
                            onAdd={() => saveCell(row.employee_id, cell, STD[0], STD[1])}
                            onOff={() => saveCell(row.employee_id, cell, null, null)}
                            onSet={(s, e) => saveCell(row.employee_id, cell, s, e)}
                            onOpen={() => setEditing({ employeeId: row.employee_id, date: cell.date })}
                            onClose={() => setEditing(null)}
                          />
                        )
                      })}
                      <td style={{ borderLeft: '1px solid var(--c-border-strong)', background: 'var(--c-bg-sunken)', textAlign: 'center' }}>
                        <span className="mono" style={{ fontSize: 13.5, fontWeight: 700, color: n === 0 ? 'var(--c-text-faint)' : 'var(--c-text)' }}>{n}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ paddingLeft: 14, fontWeight: 600, fontSize: 12, background: 'var(--c-bg-active)' }}>Людей в смене</td>
                  {data.days.map((d, i) => {
                    const c = perDay[i]
                    const low = !d.weekend && c < MIN_STAFF
                    return (
                      <td key={d.date} style={{ borderLeft: '1px solid var(--c-border)', textAlign: 'center', background: low ? 'var(--c-danger-bg)' : 'var(--c-bg-active)' }}>
                        <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: low ? 'var(--c-danger)' : c ? 'var(--c-text)' : 'var(--c-text-faint)' }}>{c || '—'}</span>
                        {low && <div style={{ fontSize: 9.5, color: 'var(--c-danger)', marginTop: 1 }}>мало</div>}
                      </td>
                    )
                  })}
                  <td style={{ borderLeft: '1px solid var(--c-border-strong)', background: 'var(--c-bg-active)', textAlign: 'center' }}>
                    <span className="mono" style={{ fontSize: 13.5, fontWeight: 700 }}>{totalShifts}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="edit" size={12} />Клик по выходному — смена. Крестик убирает день, карандаш меняет часы. Наведите на строку — «Стандарт» заполнит неделю одному. Минимум в смене — {MIN_STAFF} чел.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 11.5, color: 'var(--c-text-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--c-info)' }} />полная смена</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: 'var(--c-accent)' }} />неполная</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 11, height: 11, borderRadius: 3, border: '1.5px dashed var(--c-border-strong)' }} />выходной</span>
            </div>
          </div>
        </>
      )}
      {loading && !data && <div style={{ padding: 24, color: 'var(--c-text-subtle)' }}>Загрузка…</div>}
    </ListPage>
  )
}

// Ячейка плана: полная (info) / неполная (accent) смена с × и карандашом,
// либо выходной с «+» по наведению. Карандаш открывает редактор часов.
function PlanCell({
  cell, weekend, busy, editing, dayLabel, onAdd, onOff, onSet, onOpen, onClose,
}: {
  cell: WeekCell
  weekend: boolean
  busy: boolean
  editing: boolean
  dayLabel: string
  onAdd: () => void
  onOff: () => void
  onSet: (s: string, e: string) => void
  onOpen: () => void
  onClose: () => void
}) {
  const [hover, setHover] = useState(false)
  const on = !!cell.planned_start
  const start = cell.planned_start ?? ''
  const end = cell.planned_end ?? ''
  const std = isStd(cell.planned_start, cell.planned_end)
  const gross = on ? grossH(start, end) : 0
  const accent = on && !std
  const col = accent ? 'var(--c-accent)' : 'var(--c-info)'

  return (
    <td style={{ padding: 0, borderLeft: '1px solid var(--c-border)', position: 'relative', background: weekend && !on ? 'var(--c-bg-sunken)' : undefined, zIndex: editing ? 30 : undefined }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={on || busy ? undefined : onAdd}
        style={{
          minHeight: 54, margin: 5, borderRadius: 'var(--r-md)', cursor: on ? 'default' : 'pointer', position: 'relative',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
          border: on ? `1px solid color-mix(in oklab, ${col} 38%, transparent)` : '1.5px dashed var(--c-border-strong)',
          background: on ? (accent ? 'var(--c-accent-bg)' : 'var(--c-info-bg)') : 'transparent',
          opacity: busy ? 0.5 : 1, transition: 'background .12s, border-color .12s',
        }}
      >
        {on ? (
          <>
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: col, lineHeight: 1.15 }}>{start}</span>
            <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: col, lineHeight: 1.15, opacity: 0.85 }}>{end}</span>
            <span style={{ fontSize: 9.5, fontWeight: 600, color: col, opacity: accent ? 0.95 : 0.6, marginTop: 1 }}>
              {accent ? fmtH(gross) : 'смена'}
            </span>
            <div style={{ position: 'absolute', top: 3, right: 3, display: 'flex', flexDirection: 'column', gap: 3, opacity: hover || editing ? 1 : 0, transition: 'opacity .12s' }}>
              <button title="Сделать выходным" onClick={(ev) => { ev.stopPropagation(); if (!busy) onOff() }}
                style={{ width: 17, height: 17, borderRadius: 5, border: 0, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--c-bg-elev)', color: 'var(--c-danger)', boxShadow: 'var(--sh-1)' }}>
                <Icon name="x" size={11} />
              </button>
              <button title="Изменить часы" onClick={(ev) => { ev.stopPropagation(); editing ? onClose() : onOpen() }}
                style={{ width: 17, height: 17, borderRadius: 5, border: 0, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: editing ? 'var(--c-accent)' : 'var(--c-bg-elev)', color: editing ? '#fff' : 'var(--c-accent)', boxShadow: 'var(--sh-1)' }}>
                <Icon name="edit" size={10} />
              </button>
            </div>
          </>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 500, color: hover ? 'var(--c-info)' : 'var(--c-text-faint)' }}>
            <Icon name={hover ? 'plus' : 'sun'} size={12} />{hover ? 'смена' : 'вых.'}
          </span>
        )}
      </div>

      {editing && on && (
        <ShiftEditor start={start} end={end} dayLabel={dayLabel} gross={gross} onSet={onSet} onClose={onClose} />
      )}
    </td>
  )
}

const stepBtn: React.CSSProperties = {
  width: 30, height: 32, border: 0, background: 'var(--c-bg-sunken)', cursor: 'pointer',
  fontSize: 17, fontWeight: 600, color: 'var(--c-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center',
}

// Поповер редактирования часов смены: пресеты + ступенчатый ввод своих часов.
function ShiftEditor({
  start, end, dayLabel, gross, onSet, onClose,
}: {
  start: string
  end: string
  dayLabel: string
  gross: number
  onSet: (s: string, e: string) => void
  onClose: () => void
}) {
  const stepper = (which: 'start' | 'end') => {
    const cur = which === 'start' ? start : end
    const apply = (delta: number) => {
      const nv = addMin(cur, delta)
      if (which === 'start') onSet(nv, end)
      else onSet(start, nv)
    }
    return (
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--c-text-subtle)', marginBottom: 4 }}>{which === 'start' ? 'Приход' : 'Уход'}</div>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', overflow: 'hidden', background: 'var(--c-bg-elev)' }}>
          <button onClick={() => apply(-30)} style={stepBtn}>−</button>
          <span className="mono" style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>{cur}</span>
          <button onClick={() => apply(30)} style={stepBtn}>+</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', width: 248, zIndex: 50, background: 'var(--c-bg-elev)', borderRadius: 'var(--r-lg)', border: '1px solid var(--c-border)', boxShadow: 'var(--sh-3)', padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Icon name="clock" size={13} style={{ color: 'var(--c-accent)' }} />
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Часы смены</span>
          <span style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>· {dayLabel}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--c-accent)', background: 'var(--c-accent-bg)', padding: '1px 7px', borderRadius: 99 }}>{fmtH(gross)}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 11 }}>
          {SHIFT_PRESETS.map((p) => {
            const active = start === p.s && end === p.e
            return (
              <button key={p.label} onClick={() => onSet(p.s, p.e)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px', cursor: 'pointer', borderRadius: 'var(--r-md)', fontFamily: 'inherit', textAlign: 'left', border: '1px solid ' + (active ? 'var(--c-accent)' : 'var(--c-border)'), background: active ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)' }}>
                <span style={{ width: 14, height: 14, borderRadius: 99, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid ' + (active ? 'var(--c-accent)' : 'var(--c-border-strong)') }}>
                  {active && <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--c-accent)' }} />}
                </span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: active ? 'var(--c-accent-text)' : 'var(--c-text)' }}>{p.label}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{p.s}–{p.e}</span>
              </button>
            )
          })}
        </div>

        <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--c-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6 }}>Свои часы</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 11 }}>
          {stepper('start')}
          {stepper('end')}
        </div>

        <button className="btn primary" onClick={onClose} style={{ width: '100%', justifyContent: 'center' }}>
          <Icon name="check" size={14} />Готово
        </button>
      </div>
    </>
  )
}
