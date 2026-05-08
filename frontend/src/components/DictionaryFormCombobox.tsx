import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { FixedSizeList, type ListChildComponentProps } from 'react-window'
import type { DictionaryItem } from '../api'
import { useFixedDictionaryListPosition } from '../hooks/useFixedDictionaryListPosition'
import { FieldDropdownChevron } from './FieldDropdownChevron'

const ROW_H = 40
const LIST_MAX_H = 280
const SEARCH_DEBOUNCE_MS = 220

function choiceLabel(item: DictionaryItem): string {
  return item.is_active ? item.name : `${item.name} (не актуален)`
}

export function mergeDictionaryItemsWithCurrent(
  items: DictionaryItem[],
  currentId: string | null | undefined,
  currentName: string | null | undefined,
): DictionaryItem[] {
  const id = currentId?.trim()
  if (!id || items.some((i) => i.id === id)) return items
  const stub: DictionaryItem = {
    id,
    name: currentName ?? id,
    is_active: false,
    created_at: '',
    created_by: null,
    updated_at: null,
    updated_by: null,
  }
  return [...items, stub]
}

type Choice = { value: string; label: string }

type FormComboListRowData = {
  filtered: Choice[]
  emptySearch: boolean
  value: string
  highlight: number
  listboxId: string
  pick: (nextValue: string, label: string) => void
  onHighlightChange: (index: number) => void
}

function FormComboListRow({ index, style, data }: ListChildComponentProps<FormComboListRowData>) {
  const { filtered, emptySearch, value, highlight, listboxId, pick, onHighlightChange } = data
  if (emptySearch) {
    return (
      <div style={style} className="dictionary-form-combobox__vrow dictionary-form-combobox__vrow--empty">
        <div className="dictionary-multiselect__empty-msg">Нет совпадений</div>
      </div>
    )
  }
  const opt = filtered[index]
  if (!opt) return null
  const active = index === highlight
  const selected = opt.value === value
  return (
    <div style={style} className="dictionary-form-combobox__vrow">
      <div
        id={`${listboxId}-opt-${index}`}
        role="option"
        aria-selected={selected}
        className={`dictionary-form-combobox__option dictionary-form-combobox__option--row${active ? ' dictionary-form-combobox__option--active' : ''}`}
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

export type DictionaryFormComboboxProps = {
  id: string
  items: DictionaryItem[]
  value: string
  onChange: (nextId: string) => void
  disabled?: boolean
  /** Обязательное поле: пустой ввод при потере фокуса восстанавливает текущее значение. */
  required?: boolean
  /** Разрешить сброс (клиент / поставщик). По умолчанию = !required */
  allowClear?: boolean
  /** Подпись кнопки «×» (ТЗ: «Очистить значение»). */
  clearAriaLabel?: string
  hasError?: boolean
  /** После потери фокуса вне поля (например, touched в форме). */
  onBlur?: () => void
  /**
   * Список подсказок в `position: fixed` + портал в `document.body`.
   * Нужно внутри таблиц и блоков с overflow, иначе список обрезается и «не появляется».
   */
  listPortal?: boolean
  /** Порядок вариантов в выпадающем списке. */
  sortMode?: 'alphabet' | 'preserve'
}

export function DictionaryFormCombobox({
  id,
  items,
  value,
  onChange,
  disabled = false,
  required = false,
  allowClear = !required,
  clearAriaLabel = 'Очистить значение',
  hasError = false,
  onBlur: onBlurProp,
  listPortal = false,
  sortMode = 'preserve',
}: DictionaryFormComboboxProps) {
  const listboxId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const portalListRef = useRef<HTMLDivElement>(null)
  /** После выбора из списка (mousedown) браузер шлёт blur раньше, чем React применит setDraft — иначе applyCommit откатывает выбор. */
  const skipNextBlurCommitRef = useRef(false)

  const choices = useMemo(() => {
    const mapped = items.map((i) => ({
      value: i.id,
      label: choiceLabel(i),
    }))
    if (sortMode === 'alphabet') {
      mapped.sort((a, b) => a.label.localeCompare(b.label, 'ru', { sensitivity: 'base', numeric: true }))
    }
    return mapped
  }, [items, sortMode])

  const committedLabel = useMemo(() => {
    if (!value) return ''
    return choices.find((c) => c.value === value)?.label ?? ''
  }, [value, choices])

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
  }, [debouncedQuery, items.length, sortMode])

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return choices
    return choices.filter((c) => c.label.toLowerCase().includes(q))
  }, [debouncedQuery, choices])

  const showEmptySearch =
    debouncedQuery.trim() !== '' && filtered.length === 0 && choices.length > 0
  const emptySearch = showEmptySearch
  const showEmptyChoices = choices.length === 0
  const virtualCount = emptySearch ? 1 : filtered.length
  const listH = Math.min(LIST_MAX_H, Math.max(virtualCount * ROW_H, ROW_H))

  const listOpen =
    open && !disabled && (showEmptyChoices || filtered.length > 0 || showEmptySearch)

  const portalListStyle = useFixedDictionaryListPosition(
    listPortal,
    listOpen,
    disabled,
    wrapRef,
    portalListRef,
    items.length,
  )

  useEffect(() => {
    setHighlight((h) => (virtualCount === 0 ? 0 : Math.min(h, virtualCount - 1)))
  }, [virtualCount])

  const hasValue = value !== ''

  const applyCommit = useCallback(() => {
    const t = draft.trim()
    if (t === '') {
      if (!required) {
        onChange('')
        setDraft('')
      } else {
        setDraft(committedLabel)
      }
      setOpen(false)
      return
    }
    const exact = choices.find((c) => c.label.toLowerCase() === t.toLowerCase())
    if (exact) {
      if (exact.value !== value) onChange(exact.value)
      setDraft(exact.label)
      setOpen(false)
      return
    }
    const insub = choices.filter((c) => c.label.toLowerCase().includes(t.toLowerCase()))
    if (insub.length === 1) {
      onChange(insub[0].value)
      setDraft(insub[0].label)
      setOpen(false)
      return
    }
    setDraft(committedLabel)
    setOpen(false)
  }, [choices, committedLabel, draft, onChange, required, value])

  const pick = useCallback(
    (nextValue: string, label: string) => {
      skipNextBlurCommitRef.current = true
      onChange(nextValue)
      setDraft(label)
      setOpen(false)
      window.setTimeout(() => {
        skipNextBlurCommitRef.current = false
      }, 0)
    },
    [onChange],
  )

  const clearField = useCallback(() => {
    if (!allowClear || disabled) return
    onChange('')
    setDraft('')
    setDebouncedQuery('')
    setHighlight(0)
    setOpen(true)
    onBlurProp?.()
  }, [allowClear, disabled, onBlurProp, onChange])

  const onBlur = useCallback(
    (e: ReactFocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (wrapRef.current?.contains(next)) return
      if (listPortal && portalListRef.current?.contains(next)) return
      if (skipNextBlurCommitRef.current) {
        skipNextBlurCommitRef.current = false
        onBlurProp?.()
        return
      }
      applyCommit()
      onBlurProp?.()
    },
    [applyCommit, listPortal, onBlurProp],
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
    if (e.key === 'Backspace' && draft === '' && hasValue && allowClear) {
      e.preventDefault()
      clearField()
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

  const itemData: FormComboListRowData = useMemo(
    () => ({
      filtered,
      emptySearch,
      value,
      highlight: safeHi,
      listboxId,
      pick,
      onHighlightChange: setHighlight,
    }),
    [filtered, emptySearch, value, safeHi, listboxId, pick],
  )

  const activeDescendant =
    listOpen && !emptySearch && filtered[safeHi] ? `${listboxId}-opt-${safeHi}` : undefined

  const stopWheelBubble = useCallback((e: ReactWheelEvent) => {
    e.stopPropagation()
  }, [])

  const listInner = listOpen ? (
    <div
      ref={portalListRef}
      id={listboxId}
      className={`dictionary-form-combobox__list dictionary-form-combobox__list--virtual${listPortal ? ' dictionary-form-combobox__list--portal' : ''}`}
      style={listPortal ? portalListStyle : undefined}
      role="listbox"
      onWheel={stopWheelBubble}
    >
      {showEmptyChoices ? (
        <div className="dictionary-form-combobox__empty-catalog" role="presentation">
          <div className="dictionary-multiselect__empty-msg">Нет вариантов для выбора</div>
        </div>
      ) : (
        <FixedSizeList
          height={listH}
          width="100%"
          itemCount={virtualCount}
          itemSize={ROW_H}
          itemData={itemData}
        >
          {FormComboListRow}
        </FixedSizeList>
      )}
    </div>
  ) : null

  const placeholderText = !hasValue ? 'Выберите значение' : ''

  return (
    <div
      ref={wrapRef}
      className={`dictionary-form-combobox${allowClear && hasValue ? ' dictionary-form-combobox--has-clear' : ''}${listPortal ? ' dictionary-form-combobox--portal-root' : ''}`}
    >
      {allowClear && hasValue ? (
        <button
          type="button"
          className="list-filters__select-clear dictionary-form-combobox__clear"
          aria-label={clearAriaLabel}
          title={clearAriaLabel}
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={clearField}
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
        id={id}
        type="text"
        className={`field-input dictionary-form-combobox__input${hasError ? ' field-input--error' : ''}`}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholderText}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listOpen ? listboxId : undefined}
        aria-activedescendant={activeDescendant}
        aria-invalid={hasError || undefined}
        role="combobox"
        value={draft}
        title={committedLabel || undefined}
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
