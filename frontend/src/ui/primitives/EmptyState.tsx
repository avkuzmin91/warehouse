import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  sub?: string
  action?: ReactNode
}

export function EmptyState({ title, sub, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty-illust" />
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--c-text)' }}>{title}</div>
      {sub && <div className="text-sm muted mt-8">{sub}</div>}
      {action && <div className="mt-16">{action}</div>}
    </div>
  )
}
