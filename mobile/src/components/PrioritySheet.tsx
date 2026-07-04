import { useState } from 'react'
import { Icon } from './Icon'
import { useHardwareBack } from '../nav/backHandlers'

const OPTIONS: { rank: number | null; label: string; tone: 'danger' | 'warning' | '' }[] = [
  { rank: 1, label: 'Срочно', tone: 'danger' },
  { rank: 2, label: 'Повышенный', tone: 'warning' },
  { rank: null, label: 'Обычный', tone: '' },
]

// Шторка смены приоритета задачи упаковки/отгрузки: Срочно / Повышенный / Обычный.
export function PrioritySheet({
  current,
  onClose,
  onSave,
}: {
  current: number | null
  onClose: () => void
  onSave: (rank: number | null) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useHardwareBack(() => { if (!saving) onClose() })

  async function pick(rank: number | null) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onSave(rank)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить приоритет')
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={() => { if (!saving) onClose() }}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Приоритет</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {OPTIONS.map((o) => (
            <button
              key={String(o.rank)}
              className={o.rank === current ? 'btn' : 'btn ghost'}
              disabled={saving}
              onClick={() => void pick(o.rank)}
            >
              {o.tone ? <span className={`badge ${o.tone}`}><span className="dot" />{o.label}</span> : o.label}
              {o.rank === current && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
        {error && (
          <div className="alert" style={{ marginTop: 10 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}
        <div className="dtf-actions">
          <button className="btn ghost" disabled={saving} onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
