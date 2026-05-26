import { Icon } from './Icon'

interface CheckboxProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  label?: string
}

export function Checkbox({ checked, onChange, label }: CheckboxProps) {
  const box = (
    <div
      className={`t-checkbox ${checked ? 'checked' : ''}`}
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked) }}
    >
      {checked && <Icon name="check" size={10} />}
    </div>
  )

  if (!label) return box

  return (
    <label
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
      onClick={(e) => { e.preventDefault(); onChange?.(!checked) }}
    >
      {box}
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  )
}

interface ToggleProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  label?: string
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
      <div
        onClick={() => onChange?.(!checked)}
        style={{
          width: 30, height: 18, borderRadius: 99,
          background: checked ? 'var(--c-accent)' : 'var(--c-border-strong)',
          position: 'relative',
          transition: 'background 120ms',
          flex: '0 0 30px',
        }}
      >
        <div style={{
          position: 'absolute',
          width: 14, height: 14, borderRadius: 50,
          background: 'white', top: 2, left: checked ? 14 : 2,
          transition: 'left 120ms',
          boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        }} />
      </div>
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
    </label>
  )
}
