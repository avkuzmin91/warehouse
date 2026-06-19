import { useEffect, useState } from 'react'
import { Icon } from '../../primitives/Icon'
import { useToast } from '../../feedback/Toast'
import { EmpAvatar, fmtHours, calcDayHours } from './shared'
import { getEntry, upsertEntry, type EntryDetail } from '../../../api/timesheetApi'

const RU_MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function fmtDateRu(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()} ${RU_MON[d.getMonth()]} ${d.getFullYear()}`
}

interface Props {
  employeeId: string
  employeeName: string
  workDate: string
  today: string
  onClose: () => void
  onSaved: () => void
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: 'var(--c-text-muted)', marginBottom: 6, display: 'block' }
const timeInput: React.CSSProperties = { width: '100%', height: 34 }

export function DayCardDrawer({ employeeId, employeeName, workDate, today, onClose, onSaved }: Props) {
  const toast = useToast()
  const [detail, setDetail] = useState<EntryDetail | null>(null)
  const [ps, setPs] = useState('')
  const [pe, setPe] = useState('')
  const [fs, setFs] = useState('')
  const [fe, setFe] = useState('')
  const [absent, setAbsent] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    getEntry(employeeId, workDate, ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return
        setDetail(d)
        setPs(d.planned_start ?? '')
        setPe(d.planned_end ?? '')
        setFs(d.actual_start ?? '')
        setFe(d.actual_end ?? '')
        setAbsent(d.is_absent)
        setNote(d.note ?? '')
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [employeeId, workDate])

  const hours = calcDayHours(fs || null, fe || null)
  const isFuture = !!today && workDate > today

  const factEqualsPlan = () => { setFs(ps); setFe(pe); setAbsent(false) }
  const markAbsent = () => { setAbsent(true); setFs(''); setFe('') }

  const save = async () => {
    setSaving(true)
    try {
      await upsertEntry({
        employee_id: employeeId,
        work_date: workDate,
        planned_start: ps || null,
        planned_end: pe || null,
        actual_start: absent ? null : (fs || null),
        actual_end: absent ? null : (fe || null),
        is_absent: absent,
        note: note || null,
      })
      toast('Запись сохранена', 'success')
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
        style={{ width: 460, maxWidth: '100%', height: '100%', background: 'var(--c-bg-elev)', display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px -8px rgba(20,20,15,0.25)' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <EmpAvatar name={employeeName} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{employeeName}</div>
            <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>{fmtDateRu(workDate)} · карточка дня</div>
          </div>
          <button className="btn ghost icon sm" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={labelStyle}>План · приход</label>
              <input className="input sm" type="time" style={timeInput} value={ps} onChange={(e) => setPs(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>План · уход</label>
              <input className="input sm" type="time" style={timeInput} value={pe} onChange={(e) => setPe(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Факт · приход</label>
              <input className="input sm" type="time" style={timeInput} value={fs} disabled={absent || isFuture} onChange={(e) => setFs(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Факт · уход</label>
              <input className="input sm" type="time" style={timeInput} value={fe} disabled={absent || isFuture} onChange={(e) => setFe(e.target.value)} />
            </div>
          </div>

          {isFuture && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 16, borderRadius: 'var(--r-lg)', background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', borderLeft: '3px solid var(--c-warning)' }}>
              <Icon name="clock" size={15} style={{ color: 'var(--c-warning)', flexShrink: 0 }} />
              <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>День ещё не наступил — факт можно внести начиная с этого дня. Сейчас доступен только план.</div>
            </div>
          )}

          {!isFuture && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 16, borderRadius: 'var(--r-lg)', background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)' }}>
              <Icon name="timer" size={18} style={{ color: 'var(--c-accent)' }} />
              <div style={{ flex: 1, fontSize: 12, color: 'var(--c-text-muted)' }}>
                {fs && fe ? <><span className="mono">{fe} − {fs}</span> − <span className="mono">1 ч</span> обед</> : 'Внесите факт прихода и ухода'}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 18, fontWeight: 700 }}>{fmtHours(hours)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--c-text-subtle)' }}>отработано</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button className="btn sm" onClick={factEqualsPlan} disabled={!ps || !pe || isFuture}><Icon name="check" size={13} />Факт = план</button>
            <button
              className="btn sm"
              onClick={() => (absent ? setAbsent(false) : markAbsent())}
              disabled={isFuture}
              style={absent ? { color: 'var(--c-danger)', borderColor: 'var(--c-danger)' } : undefined}
            >
              <Icon name="userX" size={13} />{absent ? 'Снять «не вышел»' : 'Отметить «не вышел»'}
            </button>
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Примечание</label>
            <textarea className="input sm" style={{ width: '100%', minHeight: 60, padding: '8px 10px', resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр. «отпросился в 16:00»" />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              <Icon name="history" size={14} style={{ color: 'var(--c-text-subtle)' }} />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Журнал правок</span>
              <span style={{ fontSize: 11, color: 'var(--c-text-faint)' }}>append-only</span>
            </div>
            {detail && detail.ops.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {detail.ops.map((l, i) => (
                  <div key={l.id} style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--c-border-strong)', marginTop: 5 }} />
                      {i < detail.ops.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--c-border)', marginTop: 2 }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{l.comment}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 1 }}>
                        {(l.created_by_email ?? '—')} · {new Date(l.created_at).toLocaleString('ru-RU')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Записей пока нет</div>
            )}
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--c-border)', background: 'var(--c-bg)', display: 'flex', gap: 8 }}>
          <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Отмена</button>
          <button className="btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={save} disabled={saving}>
            <Icon name="save" size={14} />Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}
