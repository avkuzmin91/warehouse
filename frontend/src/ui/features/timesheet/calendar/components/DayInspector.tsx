import { useEffect, useState } from 'react'
import { Icon } from '../../../../primitives/Icon'
import { SegBtn } from './SegBtn'
import {
  MON_GEN, STATE, WD_HEAD, dayState, isWorkingState, type OverrideMap,
} from '../shared/calCore'

type Props = {
  sel: string | null
  overrides: OverrideMap
  today: string
  busy: boolean
  onSetWorking: (iso: string) => void
  onSetNonWorking: (iso: string, reason: string) => void
  onSetWorkSun: (iso: string, reason: string) => void
  onSaveReason: (iso: string, isWorking: boolean, reason: string) => void
}

export function DayInspector({
  sel, overrides, today, busy,
  onSetWorking, onSetNonWorking, onSetWorkSun, onSaveReason,
}: Props) {
  const ex = sel ? overrides[sel] : undefined
  const [reason, setReason] = useState(ex?.reason ?? '')

  useEffect(() => { setReason(ex?.reason ?? '') }, [sel, ex?.reason])

  if (!sel) {
    return (
      <div className="card" style={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="card-head">
          <Icon name="calendar" size={15} style={{ color: 'var(--c-accent)' }} />
          <span className="card-head-title">День</span>
        </div>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, color: 'var(--c-text-subtle)', padding: 24, textAlign: 'center',
        }}>
          <Icon name="calendar" size={26} style={{ color: 'var(--c-text-faint)' }} />
          <div style={{ fontSize: 13 }}>Выберите день в календаре,<br />чтобы изменить его статус или причину</div>
        </div>
      </div>
    )
  }

  const [y, mo, d] = sel.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  const st = dayState(dt, overrides)
  const m = STATE[st]
  const dow = WD_HEAD[(dt.getDay() + 6) % 7]
  const sunday = dt.getDay() === 0

  return (
    <div className="card" style={{ padding: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="card-head">
        <Icon name="calendar" size={15} style={{ color: 'var(--c-accent)' }} />
        <span className="card-head-title">{d} {MON_GEN[mo - 1]}</span>
        <span className="card-head-sub">{dow}{sel === today ? ' · сегодня' : ''}</span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', fontWeight: 500, marginBottom: 6 }}>Текущий статус</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: m.fill, border: `1px solid ${m.dot}` }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: m.text }}>{m.label}</span>
            {ex && (
              <span style={{ marginLeft: 'auto' }}>
                <span className={`badge ${st === 'worksun' ? 'success' : 'danger'}`}>
                  <span className="dot" />{st === 'worksun' ? 'Доп. смена' : 'Исключение'}
                </span>
              </span>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', fontWeight: 500, marginBottom: 6 }}>Сделать день</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <SegBtn active={isWorkingState(st) && st !== 'worksun'} disabled={busy}
              onClick={() => onSetWorking(sel)} icon="briefcase">Рабочим</SegBtn>
            <SegBtn active={st === 'holiday' || st === 'weekoff'} disabled={busy}
              onClick={() => onSetNonWorking(sel, reason)} icon="x" tone="danger">Нерабочим</SegBtn>
          </div>
          {sunday && (
            <button
              onClick={() => onSetWorkSun(sel, reason)}
              disabled={busy}
              style={{
                marginTop: 6, width: '100%', height: 32, borderRadius: 'var(--r-md)', cursor: busy ? 'default' : 'pointer',
                border: `1px solid ${st === 'worksun' ? 'var(--c-success)' : 'var(--c-border-strong)'}`,
                background: st === 'worksun' ? 'var(--c-success-bg)' : 'var(--c-bg-elev)',
                color: st === 'worksun' ? 'var(--c-success)' : 'var(--c-text-muted)',
                fontSize: 12.5, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Icon name="sun" size={13} />Назначить доп. смену (раб. воскресенье)
            </button>
          )}
        </div>

        <div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', fontWeight: 500, marginBottom: 6 }}>
            Причина {!ex ? <span style={{ color: 'var(--c-text-faint)' }}>— для нерабочего дня</span> : ''}
          </div>
          <input
            className="input sm"
            placeholder="Напр. «Праздник», «Учёт», «Переучёт»…"
            value={reason}
            disabled={!ex || busy}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => {
              if (ex && reason !== (ex.reason ?? '')) onSaveReason(sel, ex.is_working, reason)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            style={{ width: '100%', background: ex ? 'var(--c-bg-elev)' : 'var(--c-bg-sunken)' }}
          />
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--c-border)' }}>
          {ex ? (
            <button className="btn ghost sm" disabled={busy}
              onClick={() => onSetWorking(sel)} style={{ width: '100%', justifyContent: 'center' }}>
              <Icon name="refresh" size={13} />Вернуть к правилу 6/1
            </button>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', textAlign: 'center' }}>
              День следует правилу 6/1 — исключения нет
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
