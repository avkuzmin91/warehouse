import type { ReactNode, CSSProperties } from 'react'

interface ListPageProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  filters?: ReactNode
  children: ReactNode
  style?: CSSProperties
}

export function ListPage({ title, subtitle, actions, filters, children, style }: ListPageProps) {
  return (
    <div className="page" style={style}>
      <div className="page-header">
        <div>
          <div className="page-title">{title}</div>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
        {actions && <div className="row gap-8">{actions}</div>}
      </div>
      {filters && <div style={{ marginBottom: 14 }}>{filters}</div>}
      {children}
    </div>
  )
}
