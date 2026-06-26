import { useMemo, useState } from 'react'
import { Icon } from '../../primitives/Icon'
import { TimePicker } from '../../data/TimePicker'
import { useToast } from '../../feedback/Toast'
import { EmpAvatar, fmtHours, calcDayHours } from './shared'
import { dayFactBulk, type WeekCell, type DayFactItem } from '../../../api/timesheetApi'

// off — сотрудник не в плане на этот день и факта нет: выходной, отметка не требуется.
type Mode = 'work' | 'absent' | 'idle' | 'none' | 'off'
type RowInput = { employee_id: string; full_name: string; position: string | null; cell: WeekCell; locked: boolean }
type RowState = { mode: Mode; fs: string; fe: string; nl: boolean; nd: boolean }

function initState(cell: WeekCell): RowState {
  if (cell.not_called) return { mode: 'idle', fs: '', fe: '', nl: false, nd: false }
  if (cell.is_absent) return { mode: 'absent', fs: '', fe: '', nl: false, nd: false }
  if (cell.actual_start && cell.actual_end)
    return { mode: 'work', fs: cell.actual_start, fe: cell.actual_end, nl: cell.no_lunch, nd: cell.end_next_day }
  if (cell.planned_start && cell.planned_end)
    return { mode: 'none', fs: cell.planned_start, fe: cell.planned_end, nl: false, nd: false }
  return { mode: 'off', fs: '', fe: '', nl: false, nd: false }
}

/** Сворачиваем состояние строки в сравнимую строку, чтобы понять, изменилась ли запись. */
function eff(s: RowState): string {
  if (s.mode === 'absent') return 'A'
  if (s.mode === 'idle') return 'I'
  if (s.mode === 'off') return 'O'
  if (s.mode === 'work') return `W:${s.fs}-${s.fe}-${s.nl ? 1 : 0}-${s.nd ? 1 : 0}`
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

const miniToggle = (active: boolean): React.CSSProperties => ({
  width: 26, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 'var(--r-md)', cursor: 'pointer', padding: 0,
  border: '1px solid ' + (active ? 'var(--c-accent)' : 'var(--c-border-strong)'),
  background: active ? 'var(--c-accent-bg)' : 'transparent',
  color: active ? 'var(--c-accent-text)' : 'var(--c-text-faint)',
})

const segBtn = (active: boolean, tone: 'success' | 'danger' | 'muted'): React.CSSProperties => {
  const c = tone === 'muted' ? 'var(--c-text-muted)' : `var(--c-${tone})`
  return {
    border: 'none',
    cursor: 'pointer',
    padding: '0 11px',
    height: 28,
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    background: active
      ? (tone === 'muted' ? 'var(--c-bg-active)' : `color-mix(in oklab, ${c} 16%, transparent)`)
      : 'transparent',
    color: active ? c : 'var(--c-text-muted)',
  }
}

/** Цветной рейл слева по режиму строки (по плану / не вышел / не вызван / без отметки). */
const MODE_RAIL: Record<Mode, string> = {
  work: 'var(--c-success)',
  absent: 'var(--c-danger)',
  idle: 'var(--c-text-faint)',
  none: 'var(--c-warning)',
  off: 'transparent',
}

/** Лёгкая подсветка фона для строк, требующих внимания. */
function rowBg(mode: Mode): string | undefined {
  if (mode === 'none') return 'color-mix(in oklab, var(--c-warning) 4%, transparent)'
  if (mode === 'absent') return 'color-mix(in oklab, var(--c-danger) 4%, transparent)'
  return undefined
}

/** Мини-плашка часов (mono, зелёная). */
function HoursPill({ h }: { h: number }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 12, fontWeight: 700, color: 'var(--c-success)',
        background: 'color-mix(in oklab, var(--c-success) 14%, transparent)',
        padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap',
      }}
    >
      {fmtHours(h)}
    </span>
  )
}

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
        if (cur.mode === 'none' && pl.ps && pl.pe) next[r.employee_id] = { mode: 'work', fs: pl.ps, fe: pl.pe, nl: false, nd: false }
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
    else if (c.mode === 'idle') items.push({ employee_id: r.employee_id, not_called: true })
    else if (c.mode === 'work') {
      if (c.fs && c.fe) items.push({ employee_id: r.employee_id, actual_start: c.fs, actual_end: c.fe, is_absent: false, no_lunch: c.nl, end_next_day: c.nd })
    } else items.push({ employee_id: r.employee_id, actual_start: null, actual_end: null, is_absent: false, not_called: false })
  }

  const allNotCalled = () =>
    setState((s) => {
      const next = { ...s }
      for (const r of rows) {
        if (r.locked) continue
        if (next[r.employee_id].mode === 'off') continue // не в смене — «не вызван» не применяем
        next[r.employee_id] = { ...next[r.employee_id], mode: 'idle' }
      }
      return next
    })

  const counts = rows.reduce(
    (a, r) => {
      const m = state[r.employee_id].mode
      if (m === 'work') a.work++
      else if (m === 'absent') a.absent++
      else if (m === 'idle') a.idle++
      else if (m === 'off') a.off++
      else a.none++
      return a
    },
    { work: 0, absent: 0, idle: 0, none: 0, off: 0 },
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
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,20,15,0.32)', display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 600, maxWidth: '100%', height: '100%', background: 'var(--c-bg-elev)', display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px -8px rgba(20,20,15,0.25)' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in oklab, var(--c-accent) 12%, transparent)', color: 'var(--c-accent)' }}>
            <Icon name="timer" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Факт за день</div>
            <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>{dateLabel} · смена {rows.length} чел.</div>
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
              <button className="btn sm" onClick={allNotCalled}><Icon name="pause" size={13} />Никого не вызывали</button>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, display: 'flex', gap: 12 }}>
                <span style={{ color: 'var(--c-success)' }}>{counts.work} был</span>
                <span style={{ color: 'var(--c-danger)' }}>{counts.absent} не выш.</span>
                {counts.idle > 0 && <span style={{ color: 'var(--c-text-muted)' }}>{counts.idle} не выз.</span>}
                {counts.none > 0 && <span style={{ color: 'var(--c-warning)' }}>{counts.none} нужно отметить</span>}
                {counts.off > 0 && <span style={{ color: 'var(--c-text-faint)' }}>{counts.off} не в смене</span>}
              </span>
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
              {rows.map((r) => {
                const s = state[r.employee_id]
                const pl = plan[r.employee_id]
                const hrs = s.mode === 'work' ? calcDayHours(s.fs || null, s.fe || null, { lunch: !s.nl, endNextDay: s.nd }) : 0
                const bad = s.mode === 'work' && !(s.fs && s.fe)
                const hasPlan = !!(pl.ps && pl.pe)
                const outOfPlan = s.mode === 'work' && !hasPlan
                const rail = outOfPlan ? 'var(--c-warning)' : MODE_RAIL[s.mode]
                const planText = hasPlan ? `план ${pl.ps}–${pl.pe}` : 'без плана'
                const subtitle = [r.position, planText].filter(Boolean).join(' · ')
                return (
                  <div
                    key={r.employee_id}
                    style={{ position: 'relative', padding: '10px 18px', borderBottom: '1px solid var(--c-border)', background: outOfPlan ? 'color-mix(in oklab, var(--c-warning) 4%, transparent)' : rowBg(s.mode) }}
                  >
                    <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: rail }} />

                    {/* строка 1: сотрудник во всю ширину + переключатель статуса */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <EmpAvatar name={r.full_name} size={30} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.full_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
                      </div>

                      {r.locked ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, color: 'var(--c-text-subtle)', fontSize: 12 }}>
                          {s.mode === 'work' && <span className="mono" style={{ color: 'var(--c-text-muted)' }}>{s.fs}–{s.fe}{s.nd ? ' +1д' : ''}{s.nl ? ' · без обеда' : ''}</span>}
                          {s.mode === 'absent' && <span style={{ color: 'var(--c-danger)' }}>не вышел</span>}
                          {s.mode === 'idle' && <span style={{ color: 'var(--c-text-muted)' }}>не вызван</span>}
                          {s.mode === 'off' && <span style={{ color: 'var(--c-text-faint)' }}>не в смене</span>}
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <Icon name="lock" size={13} />расчёт проведён
                          </span>
                        </div>
                      ) : s.mode === 'off' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <span style={{ fontSize: 12, color: 'var(--c-text-faint)' }}>Не в смене</span>
                          <button className="btn ghost sm" style={{ color: 'var(--c-accent)' }} onClick={() => set(r.employee_id, { mode: 'work', fs: '', fe: '' })}>
                            <Icon name="userPlus" size={13} />Отметить выход
                          </button>
                        </div>
                      ) : outOfPlan ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 99, fontSize: 11, fontWeight: 600, color: 'var(--c-warning)', background: 'color-mix(in oklab, var(--c-warning) 14%, transparent)' }}>
                            <Icon name="zap" size={11} />вне плана
                          </span>
                          <button className="btn ghost icon sm" title="Убрать выход" onClick={() => set(r.employee_id, { mode: 'off', fs: '', fe: '', nl: false, nd: false })}>
                            <Icon name="x" size={13} />
                          </button>
                        </div>
                      ) : (
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
                          <button
                            onClick={() => set(r.employee_id, { mode: 'idle' })}
                            style={{ ...segBtn(s.mode === 'idle', 'muted'), borderLeft: '1px solid var(--c-border-strong)' }}
                          >
                            Не вызван
                          </button>
                        </div>
                      )}
                    </div>

                    {/* строка 2: контролы — только при «Был» и до расчёта */}
                    {!r.locked && s.mode === 'work' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, paddingLeft: 42 }}>
                        <TimePicker value={s.fs} onChange={(v) => set(r.employee_id, { fs: v })} invalid={bad} width={92} height={30} />
                        <span style={{ color: 'var(--c-text-faint)' }}>–</span>
                        <TimePicker value={s.fe} onChange={(v) => set(r.employee_id, { fe: v })} invalid={bad} width={92} height={30} />
                        <button
                          type="button"
                          onClick={() => set(r.employee_id, { nd: !s.nd })}
                          title="Смена до следующего дня (08:00 → 02:00)"
                          style={miniToggle(s.nd)}
                        >
                          <Icon name="clock" size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => set(r.employee_id, { nl: !s.nl })}
                          title="Вышел без обеда — не вычитать час"
                          style={miniToggle(s.nl)}
                        >
                          <Icon name="coffee" size={12} />
                        </button>
                        <div style={{ flex: 1 }} />
                        <HoursPill h={hrs} />
                      </div>
                    )}

                    {!r.locked && s.mode === 'idle' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, paddingLeft: 42, fontSize: 11.5, color: 'var(--c-text-muted)' }}>
                        <Icon name="pause" size={12} />Не вызван — смены не было
                      </div>
                    )}

                    {!r.locked && s.mode === 'none' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, paddingLeft: 42, fontSize: 11.5, color: 'var(--c-warning)' }}>
                        <Icon name="clock" size={12} />Нужно отметить — был, не вышел или не вызван
                      </div>
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
