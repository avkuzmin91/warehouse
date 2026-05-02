import type { ReactNode } from 'react'
import { PageContainer, type PageContainerProps } from './PageContainer'

function ListPageErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="list-page__error" role="alert">
      <p className="error-text list-page__error-text">{message}</p>
      {onRetry ? (
        <button className="btn btn--secondary list-page__error-retry" type="button" onClick={onRetry}>
          Повторить
        </button>
      ) : null}
    </div>
  )
}

export type ListPageLayoutProps = {
  /**
   * Обернуть в `PageContainer` (полная страница).
   * `false` — только блок паттерна (внутри уже существующего `PageContainer`).
   */
  wrapWithPageContainer?: boolean
  pageContainerProps?: Pick<PageContainerProps, 'maxWidth' | 'cardClassName' | 'className' | 'footer'>
  breadcrumbs: ReactNode
  /** `FiltersPanel` (фильтры + Collection Actions в одной строке). См. TZ Filters Panel / List Page Pattern. */
  filters?: ReactNode
  table: ReactNode
  pagination?: ReactNode
  error?: string | null
  onRetry?: () => void
  /** Доп. блок под таблицей (напр. второстепенные ошибки), без нарушения порядка паттерна */
  afterTable?: ReactNode
}

/**
 * Сборка list-страницы по TZ List Page Pattern:
 * Breadcrumbs → FiltersPanel → Table → Pagination (+ ошибка API с retry).
 */
export function ListPageLayout({
  wrapWithPageContainer = false,
  pageContainerProps,
  breadcrumbs,
  filters,
  table,
  pagination,
  error,
  onRetry,
  afterTable,
}: ListPageLayoutProps) {
  const inner = (
    <>
      {breadcrumbs}
      {filters}
      {table}
      {afterTable}
      {pagination}
      {error ? <ListPageErrorBanner message={error} onRetry={onRetry} /> : null}
    </>
  )

  if (wrapWithPageContainer) {
    return <PageContainer {...pageContainerProps}>{inner}</PageContainer>
  }

  return inner
}
