import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../primitives/Icon'
import type { IconName } from '../primitives/Icon'

export interface ComboboxOption {
  value: string | number
  label: string
  sub?: string
}

interface ComboboxProps {
  value: string | number | null
  onChange: (value: string | number | null, option?: ComboboxOption) => void
  options: ComboboxOption[]
  placeholder?: string
  loading?: boolean
  disabled?: boolean
  clearable?: boolean
  prefix?: IconName
}

export function Combobox({ value, onChange, options, placeholder = 'Выбрать…', loading, disabled, clearable, prefix }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [highlighted, setHighlighted] = useState(0)

  const selected = options.find((o) => String(o.value) === String(value))

  const filtered = useMemo(() => {
    if (!query) return options
    const lq = query.toLowerCase()
    return options.filter((o) =>
      o.label.toLowerCase().includes(lq) || (o.sub?.toLowerCase().includes(lq) ?? false)
    )
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        containerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return
      setOpen(false)
      setQuery('')
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = () => {
    if (disabled) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }
    setOpen(true)
    setQuery('')
    setHighlighted(0)
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  const handleSelect = (opt: ComboboxOption) => {
    onChange(opt.value, opt)
    setOpen(false)
    setQuery('')
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => Math.min(filtered.length - 1, h + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => Math.max(0, h - 1)) }
    if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) handleSelect(filtered[highlighted]) }
    if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {prefix && (
        <Icon
          name={prefix}
          size={14}
          style={{ position: 'absolute', left: 10, top: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none', zIndex: 1 }}
        />
      )}
      <div
        className="input"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: disabled ? 'default' : 'pointer',
          paddingLeft: prefix ? 32 : undefined,
          paddingRight: 6,
          opacity: disabled ? 0.5 : 1,
          height: 34,
          boxSizing: 'border-box',
        }}
        onClick={handleOpen}
      >
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlighted(0) }}
            onKeyDown={handleKey}
            placeholder="Поиск…"
            style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontSize: 13, minWidth: 0 }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span style={{ flex: 1, fontSize: 13, color: selected ? 'var(--c-text)' : 'var(--c-text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {loading ? 'Загрузка…' : (selected?.label ?? placeholder)}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {clearable && value != null && !open && (
            <span
              onClick={(e) => { e.stopPropagation(); onChange(null) }}
              style={{ color: 'var(--c-text-faint)', cursor: 'pointer', padding: '2px 2px' }}
            >
              <Icon name="x" size={12} />
            </span>
          )}
          <Icon name="chevDown" size={13} style={{ color: 'var(--c-text-subtle)' }} />
        </div>
      </div>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            ...dropdownStyle,
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-2)',
            maxHeight: 260,
            overflowY: 'auto',
            zIndex: 9999,
            padding: 4,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '12px 10px', fontSize: 12.5, color: 'var(--c-text-subtle)', textAlign: 'center' }}>
              Ничего не найдено
            </div>
          ) : filtered.map((opt, i) => (
            <div
              key={String(opt.value)}
              style={{
                padding: '7px 10px',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                background: i === highlighted ? 'var(--c-bg-hover)' : '',
                fontSize: 13,
              }}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(opt)}
            >
              <div style={{ fontWeight: String(opt.value) === String(value) ? 500 : undefined }}>
                {opt.label}
                {String(opt.value) === String(value) && (
                  <Icon name="check" size={12} style={{ marginLeft: 6, color: 'var(--c-accent)' }} />
                )}
              </div>
              {opt.sub && <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{opt.sub}</div>}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
