import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** Только внутри `FiltersPanel` (см. TZ Collection actions). */
export type CollectionActionsProps = {
  /** Если не задан — кнопка «Создать» скрыта (напр. список пользователей). */
  createHref?: string
  onResetFilters: () => void
  createLabel?: string
  resetFiltersLabel?: string
  disabled?: boolean
  /** Слот левее кнопки «Создать» (ТЗ: импорт Excel). */
  beforeCreate?: ReactNode
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

/** Иконка «Применить фильтры» (как отдельное действие рядом со сбросом). */
export function ApplyFiltersIcon() {
  return (
    <svg className="collection-actions__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 7.5v9l7.5-4.5L10 7.5z" fill="currentColor" />
    </svg>
  )
}

export function ResetFiltersIcon() {
  return (
    <svg className="collection-actions__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 5h14l-4.5 6.2V17l-5 2.5v-7.3L5 5z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M15.2 14.3l4.8 4.8M20 14.3l-4.8 4.8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Действия над коллекцией в правой части `FiltersPanel`: сброс фильтров (secondary), создание (primary +).
 * Без API; reset только через `onResetFilters` (Query State). Сортировка при сбросе не меняется (см. ТЗ).
 */
export function CollectionActions({
  createHref,
  onResetFilters,
  createLabel = 'Создать',
  resetFiltersLabel = 'Сбросить фильтры',
  disabled,
  beforeCreate,
}: CollectionActionsProps) {
  const inner = <PlusIcon />

  return (
    <div className="collection-actions">
      <button
        type="button"
        className="btn btn--secondary collection-actions__icon-btn collection-actions__reset-filters"
        onClick={onResetFilters}
        aria-label={resetFiltersLabel}
        title={resetFiltersLabel}
        disabled={disabled}
      >
        <ResetFiltersIcon />
      </button>
      {beforeCreate}
      {createHref ? (
        disabled ? (
          <span
            className="btn btn--primary collection-actions__icon-btn collection-actions__create collection-actions__create--disabled"
            aria-label={createLabel}
            title={createLabel}
            aria-disabled="true"
          >
            {inner}
          </span>
        ) : (
          <Link
            className="btn btn--primary collection-actions__icon-btn collection-actions__create"
            to={createHref}
            aria-label={createLabel}
            title={createLabel}
          >
            {inner}
          </Link>
        )
      ) : null}
    </div>
  )
}
