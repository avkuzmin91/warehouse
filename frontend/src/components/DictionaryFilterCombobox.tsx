import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { FixedSizeList, type ListChildComponentProps } from 'react-window'
import { useFixedDictionaryListPosition } from '../hooks/useFixedDictionaryListPosition'
import { foldCiSearch } from '../utils/foldCiSearch'
import { FieldDropdownChevron } from './FieldDropdownChevron'

export type DictionaryFilterKey =
  | 'type_id'
  | 'client_id'
  | 'supplier_id'
  | 'actuality_id'
  | 'users_role'
  | 'product_id'
  | 'color_id'
  | 'size_id'
  | 'receipt_status'
  | 'shipment_status'
  /** Статический список (напр. шаг графика на странице аналитики). */
  | 'analytics_group'

function splitOptions(options: { value: string; label: string }[]) {
  const placeholder = options.find((o) => o.value === '')
  const choices = options.filter((o) => o.value !== '')
  return { placeholder, choices }
}

const CLEAR_ARIA: Partial<Record<DictionaryFilterKey, string>> = {
  type_id: 'Сбросить фильтр по типу товара',
  client_id: 'Сбросить фильтр по клиенту',
  supplier_id: 'Сбросить фильтр по поставщику',
  actuality_id: 'Сбросить фильтр по актуальности',
  users_role: 'Сбросить фильтр по роли',
  product_id: 'Сбросить фильтр по товару',
  color_id: 'Сбросить фильтр по цвету',
  size_id: 'Сбросить фильтр по размеру',
  receipt_status: 'Сбросить фильтр по статусу поступления',
  shipment_status: 'Сбросить фильтр по статусу отгрузки',
  analytics_group: 'Сбросить шаг графика к значению по умолчанию',
}

type Props = {
  name: DictionaryFilterKey
  options: { value: string; label: string }[]
  valueStr: string
  onSelectChange: (name: DictionaryFilterKey, value: string | null) => void
  disabled?: boolean
  /**
   * Список подсказок в `position: fixed` + портал в `document.body`.
   * Нужно внутри таблиц с overflow, иначе список обрезается.
   */
  listPortal?: boolean
  /** Подпись кнопки сброса (иначе — по полю `name`). */
  clearAriaLabel?: string
  /** Подпись поля ввода для скринридеров. */
  ariaLabel?: string
  /** После очистки значения снова открыть список (портал/выпадающий блок). */
  openListAfterClear?: boolean
}

const ROW_H = 40
const LIST_MAX_H = 280
const SEARCH_DEBOUNCE_MS = 220

type Choice = { value: string; label: string }

type FilterComboRowData = {
  filtered: Choice[]
  emptySearch: boolean
  valueStr: string
  highlight: number
  listboxId: string
  pick: (value: string, label: string) => void
  onHighlightChange: (index: number) => void
}

function FilterComboListRow({ index, style, data }: ListChildComponentProps<FilterComboRowData>) {
  const { filtered, emptySearch, valueStr, highlight, listboxId, pick, onHighlightChange } = data
  if (emptySearch) {
    return (
      <div style={style} className="list-filters__combobox-vrow list-filters__combobox-vrow--empty">
        <div className="dictionary-multiselect__empty-msg">Нет совпадений</div>
      </div>
    )
  }
  const opt = filtered[index]
  if (!opt) return null
  const active = index === highlight
  const selected = opt.value === valueStr
  return (
    <div style={style} className="list-filters__combobox-vrow">
      <div
        id={`${listboxId}-opt-${index}`}
        role="option"
        aria-selected={selected}
        className={`list-filters__combobox-option list-filters__combobox-option--row${active ? ' list-filters__combobox-option--active' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault()
          pick(opt.value, opt.label)
        }}
        onMouseEnter={() => onHighlightChange(index)}
      >
        <span
          className={`dictionary-form-combobox__radio${selected ? ' dictionary-form-combobox__radio--on' : ''}`}
          aria-hidden
        />
        <span className="dictionary-form-combobox__option-label">{opt.label}</span>
      </div>
    </div>
  )
}

export function DictionaryFilterCombobox({
  name,
  options,
  valueStr,
  onSelectChange,
  disabled = false,
  listPortal = false,
  clearAriaLabel,
  ariaLabel,
  openListAfterClear = false,
}: Props) {
  const listboxId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const portalListRef = useRef<HTMLDivElement>(null)

  const { placeholder, choices } = useMemo(() => splitOptions(options), [options])

  const committedLabel = useMemo(() => {
    if (!valueStr) return ''
    return choices.find((c) => c.value === valueStr)?.label ?? ''
  }, [valueStr, choices])

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(committedLabel)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    if (!open) {
      setDraft(committedLabel)
    }
  }, [committedLabel, open])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(draft), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [draft])

  useEffect(() => {
    const idRaf = requestAnimationFrame(() => setHighlight(0))
    return () => cancelAnimationFrame(idRaf)
  }, [debouncedQuery, choices.length])

  const filtered = useMemo(() => {
    const q = foldCiSearch(debouncedQuery.trim())
    if (!q) return choices
    return choices.filter((c) => foldCiSearch(c.label).includes(q))
  }, [debouncedQuery, choices])

  const showEmptySearch =
    debouncedQuery.trim() !== '' && filtered.length === 0 && choices.length > 0
  const emptySearch = showEmptySearch
  const virtualCount = emptySearch ? 1 : filtered.length
  const listH = Math.min(LIST_MAX_H, Math.max(virtualCount * ROW_H, ROW_H))

  const listOpen = open && !disabled && choices.length > 0 && (filtered.length > 0 || showEmptySearch)

  const portalListStyle = useFixedDictionaryListPosition(
    listPortal,
    listOpen,
    disabled,
    wrapRef,
    portalListRef,
  )

  useEffect(() => {
    setHighlight((h) => (virtualCount === 0 ? 0 : Math.min(h, virtualCount - 1)))
  }, [virtualCount])

  const hasValue = valueStr !== ''

  const reopenListAfterClear = useCallback(() => {
    if (openListAfterClear && !disabled) {
      setOpen(true)
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setOpen(false)
    }
  }, [disabled, openListAfterClear])

  const applyCommit = useCallback(() => {
    const t = draft.trim()
    if (t === '') {
      if (valueStr) {
        onSelectChange(name, null)
        setDraft('')
        reopenListAfterClear()
      } else {
        setOpen(false)
      }
      return
    }
    const tf = foldCiSearch(t)
    const exact = choices.find((c) => foldCiSearch(c.label) === tf)
    if (exact) {
      if (exact.value !== valueStr) onSelectChange(name, exact.value)
      setDraft(exact.label)
      setOpen(false)
      return
    }
    const insub = choices.filter((c) => foldCiSearch(c.label).includes(tf))
    if (insub.length === 1) {
      onSelectChange(name, insub[0].value)
      setDraft(insub[0].label)
      setOpen(false)
      return
    }
    setDraft(committedLabel)
    setOpen(false)
  }, [choices, committedLabel, draft, name, onSelectChange, reopenListAfterClear, valueStr])

  const pick = useCallback(
    (v: string, label: string) => {
      onSelectChange(name, v)
      setDraft(label)
      setOpen(false)
      inputRef.current?.blur()
    },
    [name, onSelectChange],
  )

  const clear = useCallback(() => {
    onSelectChange(name, null)
    setDraft('')
    reopenListAfterClear()
  }, [name, onSelectChange, reopenListAfterClear])

  const onBlur = useCallback(
    (e: ReactFocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (wrapRef.current?.contains(next)) return
      if (listPortal && portalListRef.current?.contains(next)) return
      applyCommit()
    },
    [applyCommit, listPortal],
  )

  useEffect(() => {
    if (!listPortal || !listOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (portalListRef.current?.contains(t)) return
      if (wrapRef.current?.contains(t)) return
      applyCommit()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [listPortal, listOpen, applyCommit])

  const maxHi = emptySearch ? 0 : Math.max(0, filtered.length - 1)
  const safeHi = emptySearch ? 0 : Math.min(highlight, maxHi)

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(committedLabel)
      setOpen(false)
      return
    }
    if (e.key === 'Backspace' && draft === '' && hasValue) {
      e.preventDefault()
      clear()
      return
    }
    if (!choices.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => (virtualCount === 0 ? 0 : (h + 1) % virtualCount))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => (virtualCount === 0 ? 0 : (h - 1 + virtualCount) % virtualCount))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open && !emptySearch && filtered[safeHi]) {
        const row = filtered[safeHi]
        pick(row.value, row.label)
      } else {
        applyCommit()
      }
    }
  }

  const itemData: FilterComboRowData = useMemo(
    () => ({
      filtered,
      emptySearch,
      valueStr,
      highlight: safeHi,
      listboxId,
      pick,
      onHighlightChange: setHighlight,
    }),
    [filtered, emptySearch, valueStr, safeHi, listboxId, pick],
  )

  const activeDescendant =
    listOpen && !emptySearch && filtered[safeHi] ? `${listboxId}-opt-${safeHi}` : undefined

  const listInner = listOpen ? (
    <div
      ref={portalListRef}
      id={listboxId}
      className={`list-filters__combobox-list list-filters__combobox-list--virtual${listPortal ? ' list-filters__combobox-list--portal' : ''}`}
      style={listPortal ? portalListStyle : undefined}
      role="listbox"
    >
      <FixedSizeList
        height={listH}
        width="100%"
        itemCount={virtualCount}
        itemSize={ROW_H}
        itemData={itemData}
      >
        {FilterComboListRow}
      </FixedSizeList>
    </div>
  ) : null

  const ph = placeholder?.label ?? 'Выберите значение'
  const clearTitle = clearAriaLabel ?? CLEAR_ARIA[name] ?? 'Очистить значение'

  return (
    <div
      ref={wrapRef}
      className={`list-filters__combobox${hasValue ? ' list-filters__combobox--has-value' : ''}`}
    >
      {hasValue ? (
        <button
          type="button"
          className="list-filters__select-clear"
          aria-label="Очистить значение"
          title={clearTitle}
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={() => {
            if (!disabled) clear()
          }}
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
      <input
        ref={inputRef}
        type="text"
        className="field-input list-filters__input list-filters__combobox-input"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={ph}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listOpen ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        aria-label={ariaLabel}
        role="combobox"
        value={draft}
        title={committedLabel || ph}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      <FieldDropdownChevron />
      {listOpen && listPortal && typeof document !== 'undefined'
        ? createPortal(listInner, document.body)
        : null}
      {listOpen && !listPortal ? listInner : null}
    </div>
  )
}
