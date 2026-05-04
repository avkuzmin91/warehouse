import type { ChangeEvent } from 'react'

function parseDim(s: string): number {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function toInputString(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return value
}

type Props = {
  /** Связь с `<label htmlFor>`. */
  id?: string
  value: string | number
  onChange: (next: string) => void
  disabled?: boolean
  hasError?: boolean
  'aria-invalid'?: boolean
  /** Классы внутреннего input (включая field-input field-input--narrow и модификаторы ошибки). */
  inputClassName: string
}

export function ProductDimNumberInput({
  id,
  value,
  onChange,
  disabled = false,
  hasError = false,
  'aria-invalid': ariaInvalid,
  inputClassName,
}: Props) {
  const str = toInputString(value)

  function bump(delta: number) {
    if (disabled) return
    const base = str.trim() === '' ? 0 : parseDim(str)
    const next = Math.max(0, base + delta)
    onChange(String(next))
  }

  const disableDecrement = disabled || parseDim(str) <= 0

  return (
    <span
      className={`product-dim-num-field${hasError ? ' product-dim-num-field--error' : ''}`.trim()}
    >
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        className={`product-dim-num-field__input ${inputClassName}`.trim()}
        value={str}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
      <span className="product-dim-num-field__stepper" role="group" aria-label="Шаг 1">
        <button
          type="button"
          className="product-dim-num-field__step-btn product-dim-num-field__step-btn--up"
          disabled={disabled}
          aria-label="Увеличить на 1"
          title="+1"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => bump(1)}
        >
          <svg className="product-dim-num-field__step-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 6v12M6 12h12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="product-dim-num-field__step-btn product-dim-num-field__step-btn--down"
          disabled={disableDecrement}
          aria-label="Уменьшить на 1"
          title="−1"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => bump(-1)}
        >
          <svg className="product-dim-num-field__step-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </span>
    </span>
  )
}
