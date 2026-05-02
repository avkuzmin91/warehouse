import type { ReactNode } from 'react'

export type ActionBarProps = {
  /** Подпись основной кнопки (Сохранить / Создать) */
  primaryLabel: string
  secondaryLabel?: string
  onSecondary: () => void
  /** `type="submit"` с `form={submitFormId}` — кнопка может стоять вне `<form>` */
  submitFormId: string
  primaryDisabled?: boolean
  /** Доп. действия слева (например «Удалить») */
  leading?: ReactNode
  className?: string
}

/**
 * Глобальная панель действий страницы сущности: primary (submit) + secondary (отмена).
 */
export function ActionBar({
  primaryLabel,
  secondaryLabel = 'Отмена',
  onSecondary,
  submitFormId,
  primaryDisabled,
  leading,
  className = '',
}: ActionBarProps) {
  const root = ['product-form-actions', 'action-bar', className].filter(Boolean).join(' ')

  return (
    <div className={root}>
      {leading ? <div className="action-bar__leading">{leading}</div> : null}
      <div className="action-bar__trailing">
        <button
          className="btn btn--primary btn--form-action"
          type="submit"
          form={submitFormId}
          disabled={primaryDisabled}
        >
          {primaryLabel}
        </button>
        <button className="btn btn--secondary btn--form-action" type="button" onClick={onSecondary}>
          {secondaryLabel}
        </button>
      </div>
    </div>
  )
}
