import type { ReactNode } from 'react'
import { SortableTh } from './SortableTh'
import type { ListSortState } from '../utils/queryState'

export type TableColumn<TRow extends object> = {
  key: string
  title: string
  sortable?: boolean
  render?: (value: unknown, row: TRow) => ReactNode
}

export type TableProps<TRow extends object> = {
  columns: TableColumn<TRow>[]
  data: TRow[]
  loading?: boolean
  onRowClick?: (row: TRow) => void
  /** Состояние сортировки из Query State (если есть sortable-колонки). */
  sort?: ListSortState
  /** Смена сортировки (например cycleSortField из useQueryState). */
  onSortClick?: (field: string) => void
  /** Доп. класс на обёртке (например product-table-wrap). */
  wrapClassName?: string
  /** Доп. класс на table. */
  tableClassName?: string
}

function readCell(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}

function defaultRender(value: unknown): ReactNode {
  if (value == null || value === '') return '—'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return String(value)
}

function rowKey(row: object, index: number): string {
  const id = (row as { id?: string }).id
  return id ?? `row-${index}`
}

export function Table<TRow extends object>({
  columns,
  data,
  loading = false,
  onRowClick,
  sort,
  onSortClick,
  wrapClassName = '',
  tableClassName = '',
}: TableProps<TRow>) {
  const interactive = Boolean(onRowClick)
  const tableClass = ['users-table', interactive ? 'users-table--interactive' : '', tableClassName]
    .filter(Boolean)
    .join(' ')
  const wrapClass = [
    'table-wrap',
    'data-table-shell',
    loading ? 'data-table-shell--loading' : '',
    loading && data.length === 0 ? 'data-table-shell--empty-loading' : '',
    wrapClassName,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={wrapClass} aria-busy={loading || undefined}>
      <div className="data-table-shell__inner">
        <table className={tableClass}>
          <thead>
            <tr>
              {columns.map((col) =>
                col.sortable && onSortClick ? (
                  <SortableTh
                    key={col.key}
                    field={col.key}
                    label={col.title}
                    sort={sort ?? null}
                    onSortClick={onSortClick}
                  />
                ) : (
                  <th key={col.key}>{col.title}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {!loading && data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="data-table-empty">
                  Нет данных
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr key={rowKey(row, index)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                  {columns.map((col) => {
                    const raw = readCell(row, col.key)
                    const content = col.render ? col.render(raw, row) : defaultRender(raw)
                    return <td key={col.key}>{content}</td>
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {loading ? (
        <div className="data-table-loader-overlay" role="status" aria-live="polite">
          <span className="data-table-loader__spinner" aria-hidden />
          <span className="data-table-loader__text">Загрузка…</span>
        </div>
      ) : null}
    </div>
  )
}
