import { useMemo, useState } from 'react'
import { Icon } from '../../primitives/Icon'
import { useToast } from '../../feedback/Toast'
import { EmpAvatar, fmtHours, calcDayHours } from './shared'
import { dayFactBulk, type WeekCell, type DayFactItem } from '../../../api/timesheetApi'

type Mode = 'work' | 'absent' | 'none'
type RowInput = { employee_id: string; full_name: string; position: string | null; cell: WeekCell; locked: boolean }
type RowState = { mode: Mode; fs: string; fe: string }

function initState(cell: WeekCell): RowState {
  if (cell.is_absent) return { mode: 'absent', fs: '', fe: '' }
  if (cell.actual_start && cell.actual_end) return { mode: 'work', fs: cell.actual_start, fe: cell.actual_end }
  return { mode: 'none', fs: cell.planned_start ?? '', fe: cell.planned_end ?? '' }
}

/** Сворачиваем состояние строки в сравнимую строку, чтобы понять, изменилась ли запись. */
function eff(s: RowState): string {
  if (s.mode === 'absent') return 'A'
  if (s.mode === 'work') return `W:${s.fs}-${s.fe}`
  return 'N'
}

interface Props {
  date: string
  dateLabel: string
  rows: RowInput[]
  isFuture: boolean
  onClose: () => void
  onSaved: () => void
  onPrevDay?: () => void
  onNextDay?: () => void
}

const segBtn = (active: boolean, tone: 'success' | 'danger'): React.CSSProperties => ({
  border: 'none',
  cursor: 'pointer',
  padding: '0 12px',
  height: 30,
  fontSize: 12,
  fontWeight: active ? 700 : 500,
  background: active ? `color-mix(in oklab, var(--c-${tone}) 16%, transparent)` : 'transparent',
  color: active ? `var(--c-${tone})` : 'var(--c-text-muted)',
})

export function DayFactDrawer({ date, dateLabel, rows, isFuture, onClose, onSaved, onPrevDay, onNextDay }: Props) {
  const toast = useToast()
  const orig = useMemo(() => {
    const m: Record<string, RowState> = {}
    for (const r of rows) m[r.employee_id] = initState(r.cell)
    return m
  }, [rows])
  const plan = useMemo(() => {
    const m: Record<string, { ps: string | null; pe: string | null }> = {}
    for (const r of rows) m[r.employee_id] = { ps: r.cell.planned_start, pe: r.cell.planned_end }
    return m
  }, [rows])

  const [state, setState] = useState<Record<string, RowState>>(orig)
  const [saving, setSaving] = useState(false)

  const set = (id: string, patch: Partial<RowState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }))

  const allByPlan = () =>
    setState((s) => {
      const next = { ...s }
      for (const r of rows) {
        if (r.locked) continue
        const cur = next[r.employee_id]
        const pl = plan[r.employee_id]
        if (cur.mode === 'none' && pl.ps && pl.pe) next[r.employee_id] = { mode: 'work', fs: pl.ps, fe: pl.pe }
      }
      return next
    })

  const invalid = rows.filter((r) => {
    if (r.locked) return false
    const s = state[r.employee_id]
    return s.mode === 'work' && !(s.fs && s.fe)
  })

  const items: DayFactItem[] = []
  for (const r of rows) {
    if (r.locked) continue
    const o = orig[r.employee_id], c = state[r.employee_id]
    if (eff(o) === eff(c)) continue
    if (c.mode === 'absent') items.push({ employee_id: r.employee_id, is_absent: true })
    else if (c.mode === 'work') {
      if (c.fs && c.fe) items.push({ employee_id: r.employee_id, actual_start: c.fs, actual_end: c.fe, is_absent: false })
    } else items.push({ employee_id: r.employee_id, actual_start: null, actual_end: null, is_absent: false })
  }

  const counts = rows.reduce(
    (a, r) => {
      const m = state[r.employee_id].mode
      if (m === 'work') a.work++
      else if (m === 'absent') a.absent++
      else a.none++
      return a
    },
    { work: 0, absent: 0, none: 0 },
  )

  const save = async () => {
    if (!items.length || invalid.length) return
    setSaving(true)
    try {
      const r = await dayFactBulk(date, items)
      toast(`Факт сохранён: ${r.message}`, 'success')
      onSaved()
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,20,15,0.32)', display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: '100%', height: '100%', background: 'var(--c-bg-elev)', display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px -8px rgba(20,20,15,0.25)' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--c-accent) 12%, transparent)', color: 'var(--c-accent)' }}>
            <Icon name="timer" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Факт за день</div>
            <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>{dateLabel} · {rows.length} сотрудников</div>
          </div>
          {(onPrevDay || onNextDay) && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn ghost icon sm" onClick={onPrevDay} disabled={!onPrevDay} title="Предыдущий день">
                <Icon name="chev" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button className="btn ghost icon sm" onClick={onNextDay} disabled={!onNextDay} title="Следующий день">
                <Icon name="chev" size={14} />
              </button>
            </div>
          )}
          <button className="btn ghost icon sm" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        {isFuture ? (
          <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 'var(--r-lg)', background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', borderLeft: '3px solid var(--c-warning)' }}>
              <Icon name="clock" size={15} style={{ color: 'var(--c-warning)', flexShrink: 0 }} />
              <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>День ещё не наступил — факт можно внести начиная с этого дня.</div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={allByPlan}><Icon name="check" size={13} />Все по плану</button>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, display: 'flex', gap: 12 }}>
                <span style={{ color: 'var(--c-success)' }}>{counts.work} был</span>
                <span style={{ color: 'var(--c-danger)' }}>{counts.absent} не выш.</span>
                {counts.none > 0 && <span style={{ color: 'var(--c-text-faint)' }}>{counts.none} без отметки</span>}
              </span>
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
              {rows.map((r) => {
                const s = state[r.employee_id]
                const pl = plan[r.employee_id]
                const hrs = s.mode === 'work' ? calcDayHours(s.fs || null, s.fe || null) : 0
                const bad = s.mode === 'work' && !(s.fs && s.fe)
                return (
                  <div
                    key={r.employee_id}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--c-border)', background: s.mode === 'none' ? 'color-mix(in oklab, var(--c-warning) 4%, transparent)' : undefined }}
                  >
                    <EmpAvatar name={r.full_name} size={30} />
                    <div style={{ width: 132, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.full_name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--c-text-subtle)' }} className="mono">
                        {pl.ps && pl.pe ? `план ${pl.ps}–${pl.pe}` : 'без плана'}
                      </div>
                    </div>

                    {r.locked ? (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, color: 'var(--c-text-subtle)', fontSize: 12 }}>
                        {s.mode === 'work' && <span className="mono" style={{ color: 'var(--c-text-muted)' }}>{s.fs}–{s.fe}</span>}
                        {s.mode === 'absent' && <span style={{ color: 'var(--c-danger)' }}>не вышел</span>}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="lock" size={13} />расчёт проведён
                        </span>
                      </div>
                    ) : (
                      <>
                    <div style={{ display: 'flex', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', overflow: 'hidden', flexShrink: 0 }}>
                      <button
                        onClick={() => set(r.employee_id, { mode: 'work', fs: s.fs || pl.ps || '', fe: s.fe || pl.pe || '' })}
                        style={segBtn(s.mode === 'work', 'success')}
                      >
                        Был
                      </button>
                      <button
                        onClick={() => set(r.employee_id, { mode: 'absent' })}
                        style={{ ...segBtn(s.mode === 'absent', 'danger'), borderLeft: '1px solid var(--c-border-strong)' }}
                      >
                        Не вышел
                      </button>
                    </div>

                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                      {s.mode === 'work' && (
                        <>
                          <input className="input sm" type="time" style={{ width: 86, height: 30, borderColor: bad ? 'var(--c-danger)' : undefined }} value={s.fs} onChange={(e) => set(r.employee_id, { fs: e.target.value })} />
                          <span style={{ color: 'var(--c-text-faint)' }}>–</span>
                          <input className="input sm" type="time" style={{ width: 86, height: 30, borderColor: bad ? 'var(--c-danger)' : undefined }} value={s.fe} onChange={(e) => set(r.employee_id, { fe: e.target.value })} />
                          <span className="mono" style={{ width: 52, textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: 'var(--c-success)' }}>{fmtHours(hrs)}</span>
                        </>
                      )}
                      {s.mode === 'absent' && (
                        <span style={{ fontSize: 12.5, color: 'var(--c-danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Icon name="userX" size={13} />Не вышел
                        </span>
                      )}
                      {s.mode === 'none' && <span style={{ fontSize: 12, color: 'var(--c-text-faint)' }}>нужно отметить</span>}
                    </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {invalid.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--c-danger)' }}>Заполните время: {invalid.length}</span>}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn primary" onClick={save} disabled={isFuture || saving || !items.length || invalid.length > 0}>
            <Icon name="save" size={14} />Сохранить{items.length ? ` (${items.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
