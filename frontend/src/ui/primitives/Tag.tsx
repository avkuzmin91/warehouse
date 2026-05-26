import type { ReactNode } from 'react'

interface TagProps {
  children: ReactNode
  onRemove?: () => void
}

export function Tag({ children, onRemove }: TagProps) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        height: 22, padding: '0 8px',
        background: 'var(--c-bg-sunken)',
        border: '1px solid var(--c-border)',
        borderRadius: 'var(--r-sm)',
        fontSize: 12, fontWeight: 500,
        color: 'var(--c-text-muted)',
      }}
    >
      {children}
      {onRemove && (
        <span
          onClick={onRemove}
          style={{ cursor: 'pointer', color: 'var(--c-text-faint)', lineHeight: 1, marginLeft: 2 }}
        >
          ×
        </span>
      )}
    </span>
  )
}
