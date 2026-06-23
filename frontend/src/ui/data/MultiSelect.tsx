import type React from 'react'
import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../primitives/Icon'
import { Tag } from '../primitives/Tag'

export interface MultiSelectOption {
  value: string | number
  label: string
}

interface MultiSelectProps {
  value: (string | number)[]
  onChange: (value: (string | number)[]) => void
  options: MultiSelectOption[]
  placeholder?: string
  loading?: boolean
}

export function MultiSelect({ value, onChange, options, placeholder = 'Выбрать…', loading }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    if (!query) return options
    const lq = query.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(lq))
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return
      setOpen(false); setQuery('')
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function handleOpen() {
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const GAP = 4
      const MARGIN = 8
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN
      const spaceAbove = rect.top - MARGIN
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow
      const maxHeight = Math.max(160, (openUp ? spaceAbove : spaceBelow) - GAP)
      setDropdownStyle(
        openUp
          ? { position: 'fixed', bottom: window.innerHeight - rect.top + GAP, left: rect.left, width: rect.width, maxHeight }
          : { position: 'fixed', top: rect.bottom + GAP, left: rect.left, width: rect.width, maxHeight },
      )
    }
    setOpen((s) => !s)
    setQuery('')
  }

  const toggle = (v: string | number) => {
    const sv = String(v)
    if (value.map(String).includes(sv)) {
      onChange(value.filter((x) => String(x) !== sv))
    } else {
      onChange([...value, v])
    }
  }

  const selected = options.filter((o) => value.map(String).includes(String(o.value)))

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div
        className="input"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
          minHeight: 30, height: 'auto', padding: '4px 8px',
          cursor: 'pointer',
        }}
        onClick={handleOpen}
      >
        {selected.length === 0 ? (
          <span style={{ color: 'var(--c-text-subtle)', fontSize: 13, flex: 1 }}>
            {loading ? 'Загрузка…' : placeholder}
          </span>
        ) : (
          selected.map((o) => (
            <Tag key={String(o.value)} onRemove={() => toggle(o.value)}>
              {o.label}
            </Tag>
          ))
        )}
        <Icon name="chevDown" size={13} style={{ marginLeft: 'auto', color: 'var(--c-text-subtle)' }} />
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
            overflowY: 'auto',
            zIndex: 9999, padding: 4,
          }}
        >
          <div style={{ padding: '6px 8px 4px' }}>
            <input
              className="input sm"
              placeholder="Поиск…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: '12px 10px', fontSize: 12.5, color: 'var(--c-text-subtle)', textAlign: 'center' }}>
              Ничего не найдено
            </div>
          ) : filtered.map((opt) => {
            const checked = value.map(String).includes(String(opt.value))
            return (
              <div
                key={String(opt.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 10px', borderRadius: 'var(--r-md)',
                  cursor: 'pointer', fontSize: 13,
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); toggle(opt.value) }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
              >
                <div style={{
                  width: 14, height: 14, border: `1.5px solid ${checked ? 'var(--c-accent)' : 'var(--c-border-strong)'}`,
                  borderRadius: 3, background: checked ? 'var(--c-accent)' : 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flex: '0 0 14px',
                }}>
                  {checked && <Icon name="check" size={9} style={{ color: 'white' }} />}
                </div>
                {opt.label}
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </div>
  )
}
