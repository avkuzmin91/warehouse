import type { ReactNode } from 'react'

export type PageContainerProps = {
  children: ReactNode
  /** Максимальная ширина колонки контента (px). По ТЗ по умолчанию 1200. */
  maxWidth?: number
  /** Дополнительные классы для внутренней «карточки». */
  cardClassName?: string
  /** Дополнительные классы для `<main>`. */
  className?: string
  /** Содержимое вне карточки (модальные окна и т.п.), внутри `<main>`. */
  footer?: ReactNode
}

/**
 * Визуальная оболочка страницы: фон области, центрирование, max-width, карточка.
 * Не встраивает таблицы, фильтры, пагинацию и кнопки действий — только layout (см. ТЗ Page Container).
 * Не используется на `/auth` и `/auth/register`.
 */
export function PageContainer({
  children,
  maxWidth = 1200,
  cardClassName = '',
  className = '',
  footer,
}: PageContainerProps) {
  const mainClass = ['page-shell', className].filter(Boolean).join(' ')
  const cardClass = ['page-container__card', cardClassName].filter(Boolean).join(' ')

  return (
    <main className={mainClass}>
      <div className="page-container" style={{ maxWidth: `${maxWidth}px` }}>
        <div className={cardClass}>
          <div className="page-container__stack">{children}</div>
        </div>
      </div>
      {footer}
    </main>
  )
}

/** Основной вертикальный блок контента внутри карточки (после хлебных крошек и т.д.). */
export function PageContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={['page-container__content', className].filter(Boolean).join(' ')}>{children}</div>
}
