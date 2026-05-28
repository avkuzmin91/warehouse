import { Icon } from '../../../primitives/Icon'

type Props = {
  value: number
  onChange: (v: number) => void
  /** Минимум для нижней кнопки. Default: 1. */
  min?: number
  disabled?: boolean
  /** Подсветка значения (например, при превышении доступного остатка). */
  warning?: boolean
  width?: number
  height?: number
}

/**
 * Inline-степпер количества: [−] N [+]. Используется в shipment create/detail.
 */
export function NumberStep({
  value,
  onChange,
  min = 1,
  disabled = false,
  warning = false,
  width = 110,
  height = 26,
}: Props) {
  const btnH = height - 2
  const btnW = Math.max(22, Math.round(height * 0.95))
  const fontSize = height >= 30 ? 13 : 12
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: `1px solid ${warning ? 'var(--c-warning)' : 'var(--c-border-strong)'}`,
        borderRadius: 'var(--r-md)',
        height,
        width,
        background: 'var(--c-bg-elev)',
      }}
    >
      <button
        className="btn ghost icon sm"
        type="button"
        style={{ height: btnH, width: btnW, border: 0, borderRight: '1px solid var(--c-border)', flexShrink: 0 }}
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= min}
      >
        <Icon name="minus" size={10} />
      </button>
      <input
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = parseInt(e.target.value.replace(/\D/g, '')) || 0
          onChange(next)
        }}
        style={{
          flex: 1,
          border: 0,
          outline: 'none',
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize,
          fontVariantNumeric: 'tabular-nums',
          fontFeatureSettings: "'zero' 0",
          background: 'transparent',
          minWidth: 0,
          color: warning ? 'var(--c-warning)' : undefined,
        }}
      />
      <button
        className="btn ghost icon sm"
        type="button"
        style={{ height: btnH, width: btnW, border: 0, borderLeft: '1px solid var(--c-border)', flexShrink: 0 }}
        onClick={() => onChange(value + 1)}
        disabled={disabled}
      >
        <Icon name="plus" size={10} />
      </button>
    </div>
  )
}
