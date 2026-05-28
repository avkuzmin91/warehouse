interface Crumb {
  label: string
  to?: string
}

interface BreadcrumbsProps {
  crumbs: Crumb[]
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
            onClick={() => c.to && onNavigate?.(c.to)}
          >
            {c.label}
          </span>
        </span>
      ))}
    </div>
  )
}
