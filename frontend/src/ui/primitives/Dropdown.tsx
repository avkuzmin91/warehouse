import { useState, useRef, useEffect, type ReactNode } from 'react'

interface DropdownItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onClick: () => void
}

interface DropdownProps {
  trigger: ReactNode
  items: DropdownItem[]
  align?: 'left' | 'right'
}

export function Dropdown({ trigger, items, align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <div onClick={() => setOpen((s) => !s)}>{trigger}</div>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          [align === 'right' ? 'right' : 'left']: 0,
          marginTop: 4,
          background: 'var(--c-bg-elev)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-2)',
          minWidth: 160,
          zIndex: 30,
          overflow: 'hidden',
          padding: 4,
        }}>
          {items.map((item, i) => (
            <div
              key={i}
              onClick={() => { item.onClick(); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                fontSize: 13,
                color: item.danger ? 'var(--c-danger)' : 'var(--c-text)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              {item.icon && <span style={{ color: item.danger ? 'var(--c-danger)' : 'var(--c-text-subtle)' }}>{item.icon}</span>}
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
