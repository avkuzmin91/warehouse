import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { FieldDropdownChevron } from './FieldDropdownChevron'

export type DictionaryFilterKey =
  | 'type_id'
  | 'client_id'
  | 'supplier_id'
  | 'actuality_id'
  | 'users_role'

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
}

type Props = {
  name: DictionaryFilterKey
  options: { value: string; label: string }[]
  valueStr: string
  onSelectChange: (name: DictionaryFilterKey, value: string | null) => void
  disabled?: boolean
}

const MAX_SUGGESTIONS = 12

export function DictionaryFilterCombobox({
  name,
  options,
  valueStr,
  onSelectChange,
  disabled = false,
}: Props) {
  const listboxId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { placeholder, choices } = useMemo(() => splitOptions(options), [options])

  const committedLabel = useMemo(() => {
    if (!valueStr) return ''
    return choices.find((c) => c.value === valueStr)?.label ?? ''
  }, [valueStr, choices])

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

  const hasValue = valueStr !== ''

  const applyCommit = useCallback(() => {
    const t = draft.trim()
    if (t === '') {
      if (valueStr) onSelectChange(name, null)
      setDraft('')
      setOpen(false)
      return
    }
    const exact = choices.find((c) => c.label.toLowerCase() === t.toLowerCase())
    if (exact) {
      if (exact.value !== valueStr) onSelectChange(name, exact.value)
      setDraft(exact.label)
      setOpen(false)
      return
    }
    const insub = choices.filter((c) => c.label.toLowerCase().includes(t.toLowerCase()))
    if (insub.length === 1) {
      onSelectChange(name, insub[0].value)
      setDraft(insub[0].label)
      setOpen(false)
      return
    }
    setDraft(committedLabel)
    setOpen(false)
  }, [choices, committedLabel, draft, name, onSelectChange, valueStr])

  const pick = useCallback(
    (value: string, label: string) => {
      onSelectChange(name, value)
      setDraft(label)
      setOpen(false)
      inputRef.current?.blur()
    },
    [name, onSelectChange],
  )

  const clear = useCallback(() => {
    onSelectChange(name, null)
    setDraft('')
    setOpen(false)
  }, [name, onSelectChange])

  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (wrapRef.current?.contains(next)) return
      applyCommit()
    },
    [applyCommit],
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
      return
    }
  }

  const ph = placeholder?.label ?? 'Выберите'

  return (
    <div
      ref={wrapRef}
      className={`list-filters__combobox${hasValue ? ' list-filters__combobox--has-value' : ''}`}
    >
      {hasValue ? (
        <button
          type="button"
          className="list-filters__select-clear"
          aria-label={CLEAR_ARIA[name] ?? 'Очистить фильтр'}
          title="Очистить"
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
        aria-controls={open ? listboxId : undefined}
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
      {open && filtered.length > 0 && !disabled ? (
        <ul id={listboxId} className="list-filters__combobox-list" role="listbox">
          {filtered.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={i === highlight}
              className={`list-filters__combobox-option${i === highlight ? ' list-filters__combobox-option--active' : ''}`}
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
