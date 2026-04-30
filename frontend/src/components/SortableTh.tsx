import type { ListSortState } from '../utils/queryState'

type Props = {
  field: string
  label: string
  sort: ListSortState
  onSortClick: (field: string) => void
}

export function SortableTh({ field, label, sort, onSortClick }: Props) {
  const active = sort?.field === field
  const icon = !active ? '' : sort.direction === 'asc' ? '↑' : '↓'
  let ariaSort: 'none' | 'ascending' | 'descending' = 'none'
  if (active && sort) {
    ariaSort = sort.direction === 'asc' ? 'ascending' : 'descending'
  }

  return (
    <th className={active ? 'sortable-th sortable-th--active' : 'sortable-th'} aria-sort={ariaSort}>
      <button type="button" className="sortable-th__btn" onClick={() => onSortClick(field)}>
        <span className="sortable-th__label">{label}</span>
        {icon ? <span className="sortable-th__icon">{icon}</span> : null}
      </button>
    </th>
  )
}
