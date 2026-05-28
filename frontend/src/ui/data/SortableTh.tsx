import { Icon } from '../primitives/Icon'

export type SortDir = 'asc' | 'desc' | null

interface SortableThProps {
  label: string
  field: string
  sort: string | null
  dir: SortDir
  onSort: (field: string) => void
  style?: React.CSSProperties
}

export function SortableTh({ label, field, sort, dir, onSort, style }: SortableThProps) {
  const active = sort === field
  return (
    <th
      style={{ cursor: 'pointer', userSelect: 'none', ...style }}
      onClick={() => onSort(field)}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {active && dir && (
          <Icon name={dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={11} style={{ color: 'var(--c-accent)' }} />
        )}
      </span>
    </th>
  )
}
