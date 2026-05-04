import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DateRangeFilter, type DateRangeFilterModel } from './DateRangeFilter'
import { DictionaryFilterCombobox } from './DictionaryFilterCombobox'
import { FilterStyleSelectWithClear } from './FilterStyleSelectWithClear'

/** Текстовые поля с debounce (поиск по названию / артикулу / поставщику). */
export type TextFilterFieldKey = 'search' | 'name' | 'sku' | 'supplier'

export type SelectFilterFieldKey =
  | 'type'
  | 'type_id'
  | 'client_id'
  | 'supplier_id'
  | 'product_id'
  | 'color_id'
  | 'size_id'
  | 'op_type'
  | 'receipt_status'

export type DictionaryAutocompleteFilterKey =
  | 'type_id'
  | 'client_id'
  | 'supplier_id'
  | 'actuality_id'
  | 'users_role'
  | 'product_id'
  | 'color_id'
  | 'size_id'

/** Ключ селекта / комбобокса в панели фильтров (native select или dictionary autocomplete). */
export type FilterPanelSelectKey = SelectFilterFieldKey | DictionaryAutocompleteFilterKey

export type FilterFieldConfig =
  | { name: TextFilterFieldKey; type: 'text'; placeholder?: string }
  | { type: 'date_range'; placeholder: string }
  | {
      name: SelectFilterFieldKey
      type: 'select'
      options: { value: string; label: string }[]
    }
  | {
      name: DictionaryAutocompleteFilterKey
      type: 'dictionary_autocomplete'
      options: { value: string; label: string }[]
    }

type FilterValues = {
  search?: string
  name?: string
  sku?: string
  supplier?: string
  type?: string
  type_id?: string
  client_id?: string
  supplier_id?: string
  product_id?: string
  color_id?: string
  size_id?: string
  op_type?: string
  actuality_id?: string
  users_role?: string
  date_from?: string
  date_to?: string
  receipt_status?: string
}

type Props = {
  fields: FilterFieldConfig[]
  values: FilterValues
  onTextFilterDebounced: (name: TextFilterFieldKey, value: string) => void
  onSelectChange: (name: FilterPanelSelectKey, value: string | null) => void
  /** ТЗ: Date Range Filter — обновление только при валидном диапазоне */
  onDateRangeChange?: (next: DateRangeFilterModel) => void
  /** Действия справа: `CollectionActions` (сброс + создание). */
  actions?: ReactNode
  /** Блокировка полей при загрузке списка (List Page Pattern). */
  disabled?: boolean
}

const TEXT_DEBOUNCE_MS = 400

const SELECT_CLEAR_ARIA: Partial<Record<SelectFilterFieldKey, string>> = {
  type: 'Сбросить фильтр по типу',
  type_id: 'Сбросить фильтр по типу товара',
  client_id: 'Сбросить фильтр по клиенту',
  supplier_id: 'Сбросить фильтр по поставщику',
  product_id: 'Сбросить фильтр по товару',
  color_id: 'Сбросить фильтр по цвету',
  size_id: 'Сбросить фильтр по размеру',
  op_type: 'Сбросить фильтр по типу операции',
  receipt_status: 'Сбросить фильтр по статусу поступления',
}

function FilterSelectWithClear({
  name,
  options,
  valueStr,
  onSelectChange,
  disabled,
}: {
  name: SelectFilterFieldKey
  options: { value: string; label: string }[]
  valueStr: string
  onSelectChange: (name: SelectFilterFieldKey, value: string | null) => void
  disabled?: boolean
}) {
  return (
    <FilterStyleSelectWithClear
      options={options}
      valueStr={valueStr}
      onChange={(v) => onSelectChange(name, v)}
      disabled={disabled}
      clearAriaLabel="Очистить значение"
      clearTitle={SELECT_CLEAR_ARIA[name] ?? undefined}
    />
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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el != null && document.activeElement === el) {
      return
    }
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

  const grow = name === 'search' || name === 'name'

  return (
    <div
      className={
        grow ? 'list-filters__field list-filters__field--grow' : 'list-filters__field list-filters__field--text'
      }
    >
      <input
        ref={inputRef}
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
  onDateRangeChange,
  actions,
  disabled = false,
}: Props) {
  if (fields.length === 0 && actions == null) {
    return null
  }

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
                  : field.name === 'name'
                    ? values.name
                    : field.name === 'sku'
                      ? values.sku
                      : values.supplier
              }
              onDebounced={onTextFilterDebounced}
            />
          )
        }
        if (field.type === 'select') {
          const name = field.name
          let selectVal = ''
          if (name === 'type') {
            const v = values.type
            selectVal = v === 'clothes' || v === 'tech' ? v : ''
          } else if (name === 'op_type') {
            const v = values.op_type
            selectVal = v === 'in' || v === 'out' ? v : ''
          } else if (name === 'receipt_status') {
            const v = values.receipt_status
            selectVal = v === 'pending' || v === 'accepted' ? v : ''
          } else {
            const v = values[name]
            selectVal = typeof v === 'string' && v ? v : ''
          }
          return (
            <div key={name} className="list-filters__field list-filters__field--text">
              <FilterSelectWithClear
                name={name}
                options={field.options}
                valueStr={selectVal}
                onSelectChange={onSelectChange}
                disabled={disabled}
              />
            </div>
          )
        }
        if (field.type === 'dictionary_autocomplete') {
          const name = field.name
          const v = values[name]
          const selectVal = typeof v === 'string' && v ? v : ''
          return (
            <div key={name} className="list-filters__field list-filters__field--text">
              <DictionaryFilterCombobox
                name={name}
                options={field.options}
                valueStr={selectVal}
                onSelectChange={(n, id) => onSelectChange(n, id)}
                disabled={disabled}
              />
            </div>
          )
        }
        if (field.type === 'date_range') {
          return (
            <div key="date_range" className="list-filters__field list-filters__field--date-range">
              <DateRangeFilter
                placeholder={field.placeholder}
                dateFrom={values.date_from}
                dateTo={values.date_to}
                disabled={disabled || !onDateRangeChange}
                onChange={(next) => onDateRangeChange?.(next)}
              />
            </div>
          )
        }
        return null
      })}
      {actions != null ? <div className="list-filters__actions">{actions}</div> : null}
    </div>
  )
}
