import type React from 'react'
import type { ReactNode } from 'react'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../primitives/Icon'

// ─── FilterChip ──────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string
  value?: string
  active?: boolean
  onClick?: () => void
  onClear?: () => void
}

export function FilterChip({ label, value, active, onClick, onClear }: FilterChipProps) {
  return (
    <div className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
      {value && (
        <span style={{ color: active ? 'var(--c-accent-text)' : 'var(--c-text)', fontWeight: 500 }}>
          : {value}
        </span>
      )}
      {active && (
        <span
          className="x"
          onClick={(e) => { e.stopPropagation(); onClear?.() }}
        >
          <Icon name="x" size={11} />
        </span>
      )}
    </div>
  )
}

// ─── FilterSelect ─────────────────────────────────────────────────────────────

export interface FilterSelectOption {
  value: string
  label: string
}

interface FilterSelectProps {
  label: string
  value: string
  options: FilterSelectOption[]
  onChange: (value: string) => void
}

export function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  const [open, setOpen] = useState(false)
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({})
  const chipRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)
  const active = !!value

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (chipRef.current?.contains(t) || dropRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function handleToggle() {
    if (!open) {
      const rect = chipRef.current?.getBoundingClientRect()
      if (rect) {
        setDropStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, minWidth: rect.width })
      }
    }
    setOpen((s) => !s)
  }

  function handleSelect(v: string) {
    onChange(v)
    setOpen(false)
  }

  return (
    <>
      <div
        ref={chipRef}
        className={`chip ${active ? 'active' : ''}`}
        onClick={handleToggle}
        style={{ userSelect: 'none' }}
      >
        <span>{label}</span>
        {selected && (
          <span style={{ color: 'var(--c-accent-text)', fontWeight: 500 }}>: {selected.label}</span>
        )}
        {active ? (
          <span
            className="x"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false) }}
          >
            <Icon name="x" size={11} />
          </span>
        ) : (
          <Icon name="chevDown" size={11} style={{ color: 'var(--c-text-faint)', marginLeft: 2 }} />
        )}
      </div>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{
            ...dropStyle,
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-2)',
            zIndex: 9999,
            padding: 4,
            minWidth: 160,
          }}
        >
          {options.map((o) => (
            <div
              key={o.value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(o.value)}
              style={{
                padding: '7px 12px',
                borderRadius: 'var(--r-md)',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: o.value === value ? 500 : undefined,
                color: o.value === value ? 'var(--c-accent-text)' : undefined,
                background: o.value === value ? 'var(--c-accent-bg)' : undefined,
              }}
              onMouseEnter={(e) => {
                if (o.value !== value) (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)'
              }}
              onMouseLeave={(e) => {
                if (o.value !== value) (e.currentTarget as HTMLDivElement).style.background = ''
              }}
            >
              {o.label || <span style={{ color: 'var(--c-text-subtle)' }}>Все</span>}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

// ─── FilterCombobox ───────────────────────────────────────────────────────────

interface FilterComboboxProps {
  label: string
  value: string
  options: FilterSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
}

export function FilterCombobox({ label, value, options, onChange, placeholder = 'Поиск…' }: FilterComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({})
  const chipRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)
  const active = !!value

  const filtered = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (chipRef.current?.contains(t) || dropRef.current?.contains(t)) return
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function handleToggle() {
    if (!open) {
      const rect = chipRef.current?.getBoundingClientRect()
      if (rect) {
        setDropStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left })
      }
      setTimeout(() => inputRef.current?.focus(), 0)
    }
    setOpen((s) => !s)
    if (open) setSearch('')
  }

  function handleSelect(v: string) {
    onChange(v)
    setOpen(false)
    setSearch('')
  }

  return (
    <>
      <div
        ref={chipRef}
        className={`chip ${active ? 'active' : ''}`}
        onClick={handleToggle}
        style={{ userSelect: 'none' }}
      >
        <span>{label}</span>
        {selected && (
          <span style={{ color: 'var(--c-accent-text)', fontWeight: 500 }}>: {selected.label}</span>
        )}
        {active ? (
          <span
            className="x"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); setSearch('') }}
          >
            <Icon name="x" size={11} />
          </span>
        ) : (
          <Icon name="chevDown" size={11} style={{ color: 'var(--c-text-faint)', marginLeft: 2 }} />
        )}
      </div>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{
            ...dropStyle,
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-2)',
            zIndex: 9999,
            width: 220,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 320,
          }}
        >
          <div style={{ padding: '6px 6px 4px', borderBottom: '1px solid var(--c-border)' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Icon name="search" size={12} style={{ position: 'absolute', left: 8, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={placeholder}
                style={{
                  width: '100%', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)',
                  padding: '5px 8px 5px 26px', fontSize: 12.5, outline: 'none',
                  background: 'var(--c-bg-sunken)', color: 'var(--c-text)',
                }}
              />
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: 4 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--c-text-subtle)', textAlign: 'center' }}>
                Не найдено
              </div>
            ) : filtered.map((o) => (
              <div
                key={o.value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(o.value)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: o.value === value ? 500 : undefined,
                  color: o.value === value ? 'var(--c-accent-text)' : undefined,
                  background: o.value === value ? 'var(--c-accent-bg)' : undefined,
                }}
                onMouseEnter={(e) => {
                  if (o.value !== value) (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)'
                }}
                onMouseLeave={(e) => {
                  if (o.value !== value) (e.currentTarget as HTMLDivElement).style.background = ''
                }}
              >
                {o.label || <span style={{ color: 'var(--c-text-subtle)' }}>Все</span>}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ─── FiltersBar ───────────────────────────────────────────────────────────────

interface FiltersBarProps {
  children: ReactNode
}

export function FiltersBar({ children }: FiltersBarProps) {
  return <div className="filters">{children}</div>
}
