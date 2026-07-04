import type { BreadcrumbItem } from '../../utils/breadcrumbLabels'

interface BreadcrumbsProps {
  crumbs: BreadcrumbItem[]
  onNavigate?: (to: string) => void
}

export function Breadcrumbs({ crumbs, onNavigate }: BreadcrumbsProps) {
  return (
    <div className="crumbs">
      {crumbs.map((c, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="sep">/</span>}
          <span
            className={`crumb ${i === crumbs.length - 1 ? 'active' : ''}`}
            style={c.to ? undefined : { cursor: 'default' }}
            onClick={() => c.to && onNavigate?.(c.to)}
          >
            {c.label}
          </span>
        </span>
      ))}
    </div>
  )
}
