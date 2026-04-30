import type { ListQueryLimits } from '../utils/queryState'

type Props = {
  page: number
  limit: ListQueryLimits
  total: number
  onPageChange: (page: number) => void
  onLimitChange: (limit: ListQueryLimits) => void
}

function buildPageItems(totalPages: number, current: number): (number | 'ellipsis')[] {
  if (totalPages <= 1) return [1]
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const items: (number | 'ellipsis')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(totalPages - 1, current + 1)
  if (start > 2) items.push('ellipsis')
  for (let p = start; p <= end; p += 1) items.push(p)
  if (end < totalPages - 1) items.push('ellipsis')
  items.push(totalPages)
  return items
}

export function ListPagination({ page, limit, total, onPageChange, onLimitChange }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1)
  const pageItems = buildPageItems(totalPages, page)

  return (
    <div className="list-pagination">
      <div className="list-pagination__main">
        <div className="list-pagination__nav">
          <button
            className="btn btn--secondary list-pagination__btn"
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            Назад
          </button>
          <div className="list-pagination__pages" role="group" aria-label="Номера страниц">
            {pageItems.map((item, idx) =>
              item === 'ellipsis' ? (
                <span key={`e-${idx}`} className="list-pagination__ellipsis">
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={
                    item === page
                      ? 'list-pagination__page list-pagination__page--current'
                      : 'list-pagination__page'
                  }
                  onClick={() => onPageChange(item)}
                  aria-current={item === page ? 'page' : undefined}
                >
                  {item}
                </button>
              ),
            )}
          </div>
          <button
            className="btn btn--secondary list-pagination__btn"
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          >
            Вперёд
          </button>
        </div>
        <span className="list-pagination__info">
          {total === 0
            ? '0'
            : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)}`}{' '}
          из {total}
        </span>
      </div>
      <label className="list-pagination__limit">
        <span className="list-pagination__limit-label">Записей на странице</span>
        <select
          className="field-input list-pagination__select"
          value={limit}
          onChange={(event) => {
            onLimitChange(Number(event.target.value) as ListQueryLimits)
          }}
        >
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
    </div>
  )
}
