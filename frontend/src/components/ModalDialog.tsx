import { useEffect, type ReactNode } from 'react'

export type ModalDialogProps = {
  open: boolean
  /** Закрытие по Escape и при необходимости снаружи — передать общий обработчик (очистка состояния). */
  onClose: () => void
  /** `id` панели для `aria-controls` у триггера. */
  id?: string
  /** Если задан — `aria-labelledby` (заголовок внутри children должен иметь этот id). */
  ariaLabelledBy?: string
  /** Если нет `ariaLabelledBy` — краткая подпись диалога для скринридеров. */
  ariaLabel?: string
  /** Доп. классы к панели (`date-range-modal` и т.п.). Базовый класс `confirm-modal` уже добавлен. */
  panelClassName?: string
  children: ReactNode
  /** Закрытие по клику на затемнённую область (по умолчанию да). */
  closeOnBackdrop?: boolean
}

/**
 * Общая оболочка модального диалога: подложка, панель в стиле confirm-modal, Escape и клик по фону.
 */
export function ModalDialog({
  open,
  onClose,
  id,
  ariaLabelledBy,
  ariaLabel,
  panelClassName = '',
  children,
  closeOnBackdrop = true,
}: ModalDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const labelledBy = ariaLabelledBy?.trim() || undefined
  const label = ariaLabel?.trim() || undefined

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        id={id}
        className={['confirm-modal', panelClassName].filter(Boolean).join(' ').trim()}
        role="dialog"
        aria-modal="true"
        {...(labelledBy ? { 'aria-labelledby': labelledBy } : {})}
        {...(!labelledBy && label ? { 'aria-label': label } : {})}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

export type ConfirmDialogProps = {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  ariaLabel: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'danger' | 'primary'
  confirmDisabled?: boolean
}

/**
 * Диалог подтверждения: текст + «Отмена» + основное действие (destructive или primary).
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  ariaLabel,
  message,
  confirmLabel = 'ОК',
  cancelLabel = 'Отмена',
  confirmVariant = 'danger',
  confirmDisabled = false,
}: ConfirmDialogProps) {
  return (
    <ModalDialog open={open} onClose={onCancel} ariaLabel={ariaLabel} panelClassName="confirm-modal--compact">
      <p className="confirm-modal__text confirm-modal__text--lead">{message}</p>
      <div className="confirm-modal__actions confirm-modal__actions--row">
        <button type="button" className="confirm-modal__btn confirm-modal__btn--ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={
            confirmVariant === 'danger'
              ? 'confirm-modal__btn confirm-modal__btn--danger'
              : 'confirm-modal__btn confirm-modal__btn--primary'
          }
          disabled={confirmDisabled}
          onClick={() => onConfirm()}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalDialog>
  )
}
