import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DictionaryItem } from '../api'
import { FieldDropdownChevron } from './FieldDropdownChevron'

const MAX_SUGGESTIONS = 48

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
  hasError?: boolean
  /** После потери фокуса вне поля (например, touched в форме). */
  onBlur?: () => void
}

export function DictionaryFormCombobox({
  id,
  items,
  value,
  onChange,
  disabled = false,
  required = false,
  allowClear = !required,
  hasError = false,
  onBlur: onBlurProp,
}: DictionaryFormComboboxProps) {
  const listboxId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const choices = useMemo(
    () =>
      items.map((i) => ({
        value: i.id,
        label: choiceLabel(i),
      })),
    [items],
  )

  const committedLabel = useMemo(() => {
    if (!value) return ''
    return choices.find((c) => c.value === value)?.label ?? ''
  }, [value, choices])

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(committedLabel)
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    if (!open) {
      setDraft(committedLabel)
    }
  }, [committedLabel, open])

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase()
    if (!q) return choices.slice(0, MAX_SUGGESTIONS)
    return choices.filter((c) => c.label.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS)
  }, [draft, choices])

  useEffect(() => {
    setHighlight((h) => (filtered.length === 0 ? 0 : Math.min(h, filtered.length - 1)))
  }, [filtered.length])

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
      onChange(nextValue)
      setDraft(label)
      setOpen(false)
    },
    [onChange],
  )

  const clearField = useCallback(() => {
    if (!allowClear || disabled) return
    onChange('')
    setDraft('')
    setOpen(false)
    onBlurProp?.()
  }, [allowClear, disabled, onBlurProp, onChange])

  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (wrapRef.current?.contains(next)) return
      applyCommit()
      onBlurProp?.()
    },
    [applyCommit, onBlurProp],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(committedLabel)
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => (filtered.length === 0 ? 0 : (h + 1) % filtered.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) =>
        filtered.length === 0 ? 0 : (h - 1 + filtered.length) % filtered.length,
      )
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open && filtered[highlight]) {
        const row = filtered[highlight]
        pick(row.value, row.label)
      } else {
        applyCommit()
      }
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`dictionary-form-combobox${allowClear && hasValue ? ' dictionary-form-combobox--has-clear' : ''}`}
    >
      {allowClear && hasValue ? (
        <button
          type="button"
          className="list-filters__select-clear dictionary-form-combobox__clear"
          aria-label="Очистить поле"
          title="Очистить"
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
        placeholder=""
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
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
      {open && filtered.length > 0 && !disabled ? (
        <ul id={listboxId} className="dictionary-form-combobox__list" role="listbox">
          {filtered.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={i === highlight}
              className={`dictionary-form-combobox__option${i === highlight ? ' dictionary-form-combobox__option--active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(opt.value, opt.label)
              }}
              onMouseEnter={() => setHighlight(i)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
