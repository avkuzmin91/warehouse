import type { ReactNode } from 'react'

export type ActionBarProps = {
  /** Подпись основной кнопки (Сохранить / Создать) */
  primaryLabel: string
  secondaryLabel?: string
  onSecondary: () => void
  /** Кнопка без отправки формы (например асинхронная проверка Excel). */
  onPrimary?: () => void
  /** `type="submit"` с `form={submitFormId}` — если не задан `onPrimary`. */
  submitFormId?: string
  primaryDisabled?: boolean
  /** Доп. действия слева (например «Принять на склад» / «Подтвердить отгрузку») */
  leading?: ReactNode
  /** После «Отмена»: например «Удалить» */
  trailingEnd?: ReactNode
  className?: string
}

/**
 * Панель действий: primary (submit) + secondary (отмена) + опционально leading / trailingEnd.
 */
export function ActionBar({
  primaryLabel,
  secondaryLabel = 'Отмена',
  onSecondary,
  onPrimary,
  submitFormId,
  primaryDisabled,
  leading,
  trailingEnd,
  className = '',
}: ActionBarProps) {
  const root = ['product-form-actions', 'action-bar', className].filter(Boolean).join(' ')
  const primaryAsSubmit = onPrimary == null

  return (
    <div className={root}>
      {leading ? <div className="action-bar__leading">{leading}</div> : null}
      <div className="action-bar__trailing">
        <button
          className="btn btn--primary btn--form-action"
          type={primaryAsSubmit ? 'submit' : 'button'}
          form={primaryAsSubmit ? submitFormId : undefined}
          disabled={primaryDisabled}
          onClick={primaryAsSubmit ? undefined : () => onPrimary()}
        >
          {primaryLabel}
        </button>
        <button className="btn btn--secondary btn--form-action" type="button" onClick={onSecondary}>
          {secondaryLabel}
        </button>
        {trailingEnd}
      </div>
    </div>
  )
}
