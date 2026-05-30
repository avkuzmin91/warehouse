import { Icon } from '../../../primitives/Icon'

type Tone = 'normal' | 'accent' | 'warning'

type Props = {
  value: number
  onChange: (v: number) => void
  /** Минимум для нижней кнопки. Default: 1. */
  min?: number
  disabled?: boolean
  /**
   * Подсветка значения:
   * - 'warning' — превышен лимит (orange)
   * - 'accent'  — есть несохранённые изменения (indigo)
   * - 'normal'  — по умолчанию (no highlight)
   * Старый prop `warning` тоже работает (back-compat).
   */
  tone?: Tone
  /** @deprecated Используй `tone="warning"`. */
  warning?: boolean
  width?: number
  height?: number
}

function toneColor(tone: Tone): string | undefined {
  if (tone === 'warning') return 'var(--c-warning)'
  if (tone === 'accent')  return 'var(--c-accent)'
  return undefined
}

/**
 * Inline-степпер количества: [−] N [+]. Используется в shipment/receipt detail/create.
 *
 * @example
 *   <NumberStep value={qty} onChange={setQty} tone={isDirty ? 'accent' : 'normal'} />
 */
export function NumberStep({
  value,
  onChange,
  min = 1,
  disabled = false,
  tone,
  warning,
  width = 110,
  height = 26,
}: Props) {
  const effectiveTone: Tone = tone ?? (warning ? 'warning' : 'normal')
  const color = toneColor(effectiveTone)
  const btnH = height - 2
  const btnW = Math.max(22, Math.round(height * 0.95))
  const fontSize = height >= 30 ? 13 : 12
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: `1px solid ${color ?? 'var(--c-border-strong)'}`,
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
          color,
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
