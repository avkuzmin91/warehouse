import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
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

type RowData = {
  filtered: DictionaryItem[]
  emptySearch: boolean
  selectedSet: Set<string>
  highlight: number
  listboxId: string
  toggle: (id: string) => void
  onHighlightChange: (index: number) => void
}

function MultiSelectListRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const { filtered, emptySearch, selectedSet, highlight, listboxId, toggle } = data
  if (emptySearch) {
    return (
      <div style={style} className="dictionary-multiselect__row dictionary-multiselect__row--empty">
        <div className="dictionary-multiselect__empty-msg">Нет совпадений</div>
      </div>
    )
  }
  const item = filtered[index]
  if (!item) return null
  const label = choiceLabel(item)
  const on = selectedSet.has(item.id)
  const active = index === highlight
  return (
    <div style={style} className="dictionary-multiselect__row">
      <div
        id={`${listboxId}-opt-${index}`}
        role="option"
        aria-selected={on}
        className={`dictionary-multiselect__option${active ? ' dictionary-multiselect__option--active' : ''}`}
        onMouseDown={(e) => {
          e.preventDefault()
          toggle(item.id)
        }}
        onMouseEnter={() => data.onHighlightChange(index)}
      >
        <span className={`dictionary-multiselect__tick${on ? ' dictionary-multiselect__tick--on' : ''}`} aria-hidden />
        <span className="dictionary-multiselect__option-label">{label}</span>
      </div>
    </div>
  )
}

export type DictionaryMultiSelectProps = {
  id: string
  items: DictionaryItem[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** Сортировка списка: по алфавиту (цвета) или порядок с сервера (размеры). */
  sortMode?: 'alphabet' | 'preserve'
  disabled?: boolean
  hasError?: boolean
  onBlur?: () => void
  placeholder?: string
  allowClearAll?: boolean
  /** Портал для списка (рекомендуется в карточках с overflow). */
  listPortal?: boolean
  'aria-labelledby'?: string
  'aria-label'?: string
}

export function DictionaryMultiSelect({
  id,
  items,
  selectedIds,
  onChange,
  sortMode = 'alphabet',
  disabled = false,
  hasError = false,
  onBlur: onBlurProp,
  placeholder = 'Выберите значения',
  allowClearAll = true,
  listPortal = true,
  'aria-labelledby': ariaLabelledBy,
  'aria-label': ariaLabel,
}: DictionaryMultiSelectProps) {
  const listboxId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const portalListRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(draft), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [draft])

  useEffect(() => {
    const id = requestAnimationFrame(() => setHighlight(0))
    return () => cancelAnimationFrame(id)
  }, [debouncedQuery, items.length, sortMode])

  const sortedItems = useMemo(() => {
    const copy = [...items]
    if (sortMode === 'alphabet') {
      copy.sort((a, b) =>
        choiceLabel(a).localeCompare(choiceLabel(b), 'ru', { sensitivity: 'base', numeric: true }),
      )
    }
    return copy
  }, [items, sortMode])

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    if (!q) return sortedItems
    return sortedItems.filter((i) => choiceLabel(i).toLowerCase().includes(q))
  }, [sortedItems, debouncedQuery])

  const showEmptySearch =
    debouncedQuery.trim() !== '' && filtered.length === 0 && sortedItems.length > 0
  const emptySearch = showEmptySearch
  const virtualCount = emptySearch ? 1 : filtered.length
  const listH = Math.min(LIST_MAX_H, Math.max(virtualCount * ROW_H, ROW_H))

  const itemById = useMemo(() => {
    const m = new Map<string, DictionaryItem>()
    for (const i of items) m.set(i.id, i)
    return m
  }, [items])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const toggle = useCallback(
    (itemId: string) => {
      if (disabled) return
      const has = selectedIds.includes(itemId)
      if (has) onChange(selectedIds.filter((x) => x !== itemId))
      else onChange([...selectedIds, itemId])
    },
    [disabled, onChange, selectedIds],
  )

  const removeChip = useCallback(
    (itemId: string) => {
      if (disabled) return
      onChange(selectedIds.filter((x) => x !== itemId))
    },
    [disabled, onChange, selectedIds],
  )

  const clearAll = useCallback(() => {
    if (disabled) return
    onChange([])
    onBlurProp?.()
  }, [disabled, onChange, onBlurProp])

  const showList = open && !disabled && items.length > 0
  const portalListStyle = useFixedDictionaryListPosition(
    listPortal,
    showList,
    disabled,
    wrapRef,
    portalListRef,
  )

  const onBlur = useCallback(
    (e: ReactFocusEvent<HTMLInputElement>) => {
      const next = e.relatedTarget as Node | null
      if (wrapRef.current?.contains(next)) return
      if (listPortal && portalListRef.current?.contains(next)) return
      setOpen(false)
      onBlurProp?.()
    },
    [listPortal, onBlurProp],
  )

  useEffect(() => {
    if (!listPortal || !showList) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (portalListRef.current?.contains(t)) return
      if (wrapRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [listPortal, showList])

  const maxHi = emptySearch ? 0 : Math.max(0, filtered.length - 1)

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'Backspace' && draft === '' && selectedIds.length > 0) {
      e.preventDefault()
      onChange(selectedIds.slice(0, -1))
      return
    }
    if (!items.length) return
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
      if (open && !emptySearch) {
        const row = filtered[Math.min(highlight, maxHi)]
        if (row) toggle(row.id)
      }
      return
    }
  }

  const itemData: RowData = useMemo(
    () => ({
      filtered,
      emptySearch,
      selectedSet,
      highlight: emptySearch ? 0 : Math.min(highlight, maxHi),
      listboxId,
      toggle,
      onHighlightChange: setHighlight,
    }),
    [filtered, emptySearch, selectedSet, highlight, maxHi, listboxId, toggle],
  )

  const activeDescendant =
    open && showList && !emptySearch && filtered[Math.min(highlight, maxHi)]
      ? `${listboxId}-opt-${Math.min(highlight, maxHi)}`
      : undefined

  const listInner = showList ? (
    <div
      ref={portalListRef}
      id={listboxId}
      className={`dictionary-form-combobox__list dictionary-multiselect__list${listPortal ? ' dictionary-form-combobox__list--portal' : ''}`}
      style={listPortal ? portalListStyle : undefined}
      role="listbox"
      aria-multiselectable
    >
      <FixedSizeList
        height={listH}
        width="100%"
        itemCount={virtualCount}
        itemSize={ROW_H}
        itemData={itemData}
      >
        {MultiSelectListRow}
      </FixedSizeList>
    </div>
  ) : null

  const inputPlaceholder = selectedIds.length === 0 ? placeholder : ''

  return (
    <div
      ref={wrapRef}
      className={`dictionary-multiselect dictionary-form-combobox${selectedIds.length > 0 ? ' dictionary-multiselect--has-chips' : ''}${listPortal ? ' dictionary-form-combobox--portal-root' : ''}${allowClearAll && selectedIds.length > 0 ? ' dictionary-form-combobox--has-clear' : ''}`}
    >
      {allowClearAll && selectedIds.length > 0 ? (
        <button
          type="button"
          className="list-filters__select-clear dictionary-form-combobox__clear"
          aria-label="Очистить всё"
          title="Очистить всё"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={clearAll}
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
      <div
        className={`dictionary-multiselect__control field-input${hasError ? ' field-input--error' : ''}`}
        onMouseDown={() => {
          if (!disabled) inputRef.current?.focus()
        }}
      >
        <div className="dictionary-multiselect__chips" aria-live="polite">
          {selectedIds.map((sid) => {
            const item = itemById.get(sid)
            const lab = item ? choiceLabel(item) : sid
            return (
              <span key={sid} className="dictionary-multiselect__chip">
                <span className="dictionary-multiselect__chip-text">{lab}</span>
                <button
                  type="button"
                  className="dictionary-multiselect__chip-remove"
                  aria-label={`Удалить ${lab}`}
                  disabled={disabled}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onClick={() => removeChip(sid)}
                >
                  ×
                </button>
              </span>
            )
          })}
          <input
            ref={inputRef}
            id={id}
            type="text"
            className="dictionary-multiselect__input"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder={inputPlaceholder}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={activeDescendant}
            aria-invalid={hasError || undefined}
            aria-labelledby={ariaLabelledBy}
            aria-label={ariaLabelledBy ? undefined : ariaLabel ?? 'Мультивыбор из справочника'}
            role="combobox"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      <FieldDropdownChevron />
      {showList && listPortal && typeof document !== 'undefined' ? createPortal(listInner, document.body) : null}
      {showList && !listPortal ? listInner : null}
    </div>
  )
}
