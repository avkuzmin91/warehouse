import { Link } from 'react-router-dom'

export type CollectionActionsProps = {
  /** Маршрут страницы создания сущности. */
  createHref: string
  /** Подпись для aria и подсказки (по умолчанию «Создать»). */
  createLabel?: string
  /** Подпись для сброса фильтров (aria и подсказка). */
  resetFiltersLabel?: string
  /** Сброс фильтров в Query State (без API). */
  onResetFilters: () => void
}

function PlusIcon() {
  return (
    <svg className="collection-actions__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ResetFiltersIcon() {
  return (
    <svg className="collection-actions__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polyline
        points="23 4 23 10 17 10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="1 20 1 14 7 14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Блок действий списка справочника: создание + сброс фильтров (иконки).
 * Размещается в одной строке с фильтрами, справа.
 */
export function CollectionActions({
  createHref,
  createLabel = 'Создать',
  resetFiltersLabel = 'Сбросить фильтры',
  onResetFilters,
}: CollectionActionsProps) {
  return (
    <div className="collection-actions">
      <button
        type="button"
        className="btn btn--secondary collection-actions__icon-btn collection-actions__reset-filters"
        onClick={onResetFilters}
        aria-label={resetFiltersLabel}
        title={resetFiltersLabel}
      >
        <ResetFiltersIcon />
      </button>
      <Link
        className="btn btn--primary collection-actions__icon-btn collection-actions__create"
        to={createHref}
        aria-label={createLabel}
        title={createLabel}
      >
        <PlusIcon />
      </Link>
    </div>
  )
}
