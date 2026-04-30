import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

/** Текстовые поля с debounce (поиск по названию / артикулу / поставщику). */
export type TextFilterFieldKey = 'search' | 'sku' | 'supplier'

export type FilterFieldConfig =
  | { name: TextFilterFieldKey; type: 'text'; placeholder?: string }
  | {
      name: 'type'
      type: 'select'
      options: { value: string; label: string }[]
    }
  | {
      name: 'is_active'
      type: 'select'
      options: { value: string; label: string }[]
    }

type FilterValues = {
  search?: string
  sku?: string
  supplier?: string
  type?: string
  is_active?: boolean
}

type Props = {
  fields: FilterFieldConfig[]
  values: FilterValues
  onTextFilterDebounced: (name: TextFilterFieldKey, value: string) => void
  onSelectChange: (name: 'type' | 'is_active', value: string | boolean | null) => void
  /** Действия списка (Collection Actions): «Создать», «Сбросить фильтры» и т.д. */
  actions: ReactNode
}

const TEXT_DEBOUNCE_MS = 400

function splitSelectFilterOptions(options: { value: string; label: string }[]) {
  const placeholder = options.find((o) => o.value === '')
  const choices = options.filter((o) => o.value !== '')
  return { placeholder, choices }
}

function FilterSelectWithClear({
  name,
  options,
  valueStr,
  onSelectChange,
}: {
  name: 'type' | 'is_active'
  options: { value: string; label: string }[]
  valueStr: string
  onSelectChange: (name: 'type' | 'is_active', value: string | boolean | null) => void
}) {
  const { placeholder, choices } = splitSelectFilterOptions(options)
  const hasValue = valueStr !== ''

  return (
    <div className={`list-filters__select-wrap${hasValue ? ' list-filters__select-wrap--has-value' : ''}`}>
      {hasValue ? (
        <button
          type="button"
          className="list-filters__select-clear"
          aria-label={name === 'type' ? 'Сбросить фильтр по типу' : 'Сбросить фильтр по статусу'}
          title="Очистить"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={() => onSelectChange(name, null)}
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
        className="field-input list-filters__select"
        value={valueStr}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') onSelectChange(name, null)
          else if (name === 'type') onSelectChange('type', raw)
          else onSelectChange('is_active', raw === 'true')
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
    </div>
  )
}

function DebouncedTextFilterRow({
  name,
  placeholder,
  committedValue,
  onDebounced,
}: {
  name: TextFilterFieldKey
  placeholder: string
  committedValue: string | undefined
  onDebounced: (name: TextFilterFieldKey, value: string) => void
}) {
  const [draft, setDraft] = useState(committedValue ?? '')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraft(committedValue ?? '')
  }, [committedValue])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const flush = useCallback(
    (raw: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      onDebounced(name, raw.trim())
    },
    [name, onDebounced],
  )

  const schedule = useCallback(
    (raw: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        onDebounced(name, raw.trim())
      }, TEXT_DEBOUNCE_MS)
    },
    [name, onDebounced],
  )

  const grow = name === 'search'

  return (
    <div
      className={
        grow ? 'list-filters__field list-filters__field--grow' : 'list-filters__field list-filters__field--text'
      }
    >
      <input
        className="field-input list-filters__input"
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          schedule(v)
        }}
        onBlur={() => flush(draft)}
      />
    </div>
  )
}

export function FiltersPanel({
  fields,
  values,
  onTextFilterDebounced,
  onSelectChange,
  actions,
}: Props) {
  return (
    <div className="list-filters">
      {fields.map((field) => {
        if (field.type === 'text') {
          return (
            <DebouncedTextFilterRow
              key={field.name}
              name={field.name}
              placeholder={field.placeholder ?? 'Поиск...'}
              committedValue={
                field.name === 'search'
                  ? values.search
                  : field.name === 'sku'
                    ? values.sku
                    : values.supplier
              }
              onDebounced={onTextFilterDebounced}
            />
          )
        }
        if (field.type === 'select' && field.name === 'type') {
          const v = values.type
          const selectVal = v === 'clothes' || v === 'tech' ? v : ''
          return (
            <div key="type" className="list-filters__field list-filters__field--text">
              <FilterSelectWithClear
                name="type"
                options={field.options}
                valueStr={selectVal}
                onSelectChange={onSelectChange}
              />
            </div>
          )
        }
        if (field.type === 'select' && field.name === 'is_active') {
          const v = values.is_active
          const selectVal = v === true ? 'true' : v === false ? 'false' : ''
          return (
            <div key="is_active" className="list-filters__field list-filters__field--text">
              <FilterSelectWithClear
                name="is_active"
                options={field.options}
                valueStr={selectVal}
                onSelectChange={onSelectChange}
              />
            </div>
          )
        }
        return null
      })}
      <div className="list-filters__actions">{actions}</div>
    </div>
  )
}
