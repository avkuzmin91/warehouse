import { Icon } from '../primitives/Icon'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPage }: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
      padding: '10px 14px', borderTop: '1px solid var(--c-border)',
      fontSize: 12.5, color: 'var(--c-text-muted)',
    }}>
      <span className="mono" style={{ fontSize: 12 }}>
        {from}–{to} из {total}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          className="btn ghost icon sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          <Icon name="arrowLeft" size={13} />
        </button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          let p: number
          if (totalPages <= 7) {
            p = i + 1
          } else if (page <= 4) {
            p = i < 5 ? i + 1 : i === 5 ? -1 : totalPages
          } else if (page >= totalPages - 3) {
            p = i === 0 ? 1 : i === 1 ? -1 : totalPages - (6 - i)
          } else {
            if (i === 0) p = 1
            else if (i === 1) p = -1
            else if (i === 5) p = -1
            else if (i === 6) p = totalPages
            else p = page + (i - 3)
          }
          if (p === -1) return <span key={i} style={{ color: 'var(--c-text-faint)', padding: '0 2px' }}>…</span>
          return (
            <button
              key={i}
              className={`btn ${p === page ? 'primary' : 'ghost'} sm`}
              style={{ minWidth: 28, padding: '0 6px' }}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          )
        })}
        <button
          className="btn ghost icon sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
        >
          <Icon name="arrowRight" size={13} />
        </button>
      </div>
    </div>
  )
}
