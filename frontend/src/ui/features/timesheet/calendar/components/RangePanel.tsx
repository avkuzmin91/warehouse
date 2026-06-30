import { useState } from 'react'
import { Icon } from '../../../../primitives/Icon'
import { SegBtn } from './SegBtn'
import type { BulkApplyMode } from '../../../../../api/productionCalendarApi'
import { fmtDow, fmtLong } from '../shared/calCore'

type Props = {
  dates: string[]
  busy: boolean
  onApply: (mode: BulkApplyMode, reason: string) => void
  onClear: () => void
}

export function RangePanel({ dates, busy, onApply, onClear }: Props) {
  const [mode, setMode] = useState<BulkApplyMode>('nonworking')
  const [reason, setReason] = useState('')

  const sorted = [...dates].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = first === last
    ? `${fmtLong(first)} · ${fmtDow(first)}`
    : `${fmtLong(first)} – ${fmtLong(last)} · ${fmtDow(first)}–${fmtDow(last)}`

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="card-head" style={{ background: 'var(--c-accent-bg)', borderColor: 'transparent' }}>
        <Icon name="layers" size={15} style={{ color: 'var(--c-accent)' }} />
        <span className="card-head-title" style={{ color: 'var(--c-accent-text)' }}>Выбрано {dates.length} дней</span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{span}</div>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', fontWeight: 500, marginBottom: 6 }}>Применить ко всем</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <SegBtn active={mode === 'working'} disabled={busy} onClick={() => setMode('working')} icon="briefcase">Рабочими</SegBtn>
            <SegBtn active={mode === 'nonworking'} disabled={busy} onClick={() => setMode('nonworking')} icon="x" tone="danger">Нерабочими</SegBtn>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--c-text-muted)', fontWeight: 500, marginBottom: 6 }}>
            Причина (всем) {mode === 'working' ? <span style={{ color: 'var(--c-text-faint)' }}>— для доп. смен</span> : ''}
          </div>
          <input
            className="input sm"
            placeholder="Напр. «Майские — продлённые выходные»"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <button className="btn primary sm" disabled={busy}
          onClick={() => onApply(mode, reason.trim())} style={{ justifyContent: 'center' }}>
          <Icon name="check" size={13} />Применить к {dates.length} дням
        </button>
        <button className="btn ghost sm" disabled={busy} onClick={onClear} style={{ justifyContent: 'center' }}>
          Сбросить выбор
        </button>
      </div>
    </div>
  )
}
