import { FieldDropdownChevron } from './FieldDropdownChevron'

export type FilterStyleSelectOption = { value: string; label: string }

function splitSelectOptions(options: FilterStyleSelectOption[]) {
  const placeholder = options.find((o) => o.value === '')
  const choices = options.filter((o) => o.value !== '')
  return { placeholder, choices }
}

/** Native select как в панели фильтров: плейсхолдер (value ""), крестик сброса, стрелка, классы `list-filters__select*`. */
export function FilterStyleSelectWithClear({
  options,
  valueStr,
  onChange,
  disabled,
  clearAriaLabel = 'Очистить значение',
  clearTitle,
  selectAriaLabel,
}: {
  options: FilterStyleSelectOption[]
  valueStr: string
  onChange: (value: string | null) => void
  disabled?: boolean
  clearAriaLabel?: string
  /** Подсказка при наведении (например, контекст фильтра). */
  clearTitle?: string
  selectAriaLabel?: string
}) {
  const { placeholder, choices } = splitSelectOptions(options)
  const hasValue = valueStr !== ''

  return (
    <div className={`list-filters__select-wrap${hasValue ? ' list-filters__select-wrap--has-value' : ''}`}>
      {hasValue ? (
        <button
          type="button"
          className="list-filters__select-clear"
          aria-label={clearAriaLabel}
          title={clearTitle ?? clearAriaLabel}
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={() => onChange(null)}
        >
          <svg className="list-filters__select-clear-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M18 6L6 18M6 6l12 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
      <select
        className={`field-input list-filters__select${hasValue ? '' : ' list-filters__select--empty'}`.trim()}
        aria-label={selectAriaLabel}
        value={valueStr}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') onChange(null)
          else onChange(raw)
        }}
      >
        {placeholder ? (
          <option value="" disabled hidden>
            {placeholder.label}
          </option>
        ) : null}
        {choices.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <FieldDropdownChevron />
    </div>
  )
}
