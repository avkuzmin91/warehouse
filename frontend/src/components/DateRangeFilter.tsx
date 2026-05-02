import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { ModalDialog } from './ModalDialog'

/** Значения в query/API: YYYY-MM-DD (ТЗ «Фильтр даты»). */
export type DateRangeFilterModel = {
  date_from?: string
  date_to?: string
}

export type DateRangeFilterProps = {
  dateFrom?: string
  dateTo?: string
  /** Подпись фильтруемого поля: пустое состояние триггера и заголовок модалки (как placeholder у текстовых фильтров). */
  placeholder: string
  /** Вызывается только при валидном диапазоне или при очистке полей */
  onChange: (next: DateRangeFilterModel) => void
  disabled?: boolean
  className?: string
}

export const DATE_RANGE_INVALID_MESSAGE = 'Неверный диапазон дат'

const LABEL_FROM = 'С'
const LABEL_TO = 'По'

function isValidYyyyMmDd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

/** Отображение одной даты DD.MM.YYYY */
export function formatIsoDateToDdMmYyyy(iso: string): string {
  if (!isValidYyyyMmDd(iso)) return iso
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

/** Строка в поле фильтра: «ДД.ММ.ГГГГ-ДД.ММ.ГГГГ» (частично — с дефисом с одной стороны). */
export function formatDateRangeTriggerLabel(dateFrom?: string, dateTo?: string): string {
  const hasF = Boolean(dateFrom && isValidYyyyMmDd(dateFrom))
  const hasT = Boolean(dateTo && isValidYyyyMmDd(dateTo))
  if (!hasF && !hasT) return ''
  const partF = hasF ? formatIsoDateToDdMmYyyy(dateFrom!) : ''
  const partT = hasT ? formatIsoDateToDdMmYyyy(dateTo!) : ''
  return `${partF}-${partT}`
}

export function DateRangeFilter({
  dateFrom,
  dateTo,
  placeholder,
  onChange,
  disabled = false,
  className = '',
}: DateRangeFilterProps) {
  const titleId = useId()
  const dialogId = useId()
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState('')
  const [draftTo, setDraftTo] = useState('')
  const [modalError, setModalError] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

  const summary = formatDateRangeTriggerLabel(dateFrom, dateTo)
  const hasValue = summary !== ''

  useEffect(() => {
    if (!open) return
    setDraftFrom(dateFrom ?? '')
    setDraftTo(dateTo ?? '')
    setModalError('')
  }, [open, dateFrom, dateTo])

  function applyModal() {
    const f = draftFrom.trim() || undefined
    const t = draftTo.trim() || undefined
    if (f && t && f > t) {
      setModalError(DATE_RANGE_INVALID_MESSAGE)
      return
    }
    setModalError('')
    onChange({ date_from: f, date_to: t })
    setOpen(false)
  }

  function clearRange(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (disabled) return
    onChange({ date_from: undefined, date_to: undefined })
    setModalError('')
  }

  return (
    <div className={`date-range-filter ${className}`.trim()}>
      <div className="date-range-filter__trigger-wrap">
        {hasValue ? (
          <button
            type="button"
            className="date-range-filter__clear"
            aria-label={`Очистить: ${placeholder}`}
            title="Очистить"
            disabled={disabled}
            onClick={clearRange}
          >
            <svg className="date-range-filter__clear-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M18 6L6 18M6 6l12 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
        <button
          ref={triggerRef}
          type="button"
          className={`field-input date-range-filter__trigger${hasValue ? '' : ' date-range-filter__trigger--placeholder'}`.trim()}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-label={placeholder}
          title={hasValue ? summary : placeholder}
          onClick={() => {
            if (!disabled) setOpen(true)
          }}
        >
          {hasValue ? summary : placeholder}
        </button>
      </div>

      <ModalDialog
        open={open}
        onClose={() => {
          setOpen(false)
          setModalError('')
        }}
        id={dialogId}
        ariaLabelledBy={titleId}
        panelClassName="date-range-modal"
      >
        <h2 id={titleId} className="date-range-modal__title">
          {placeholder}
        </h2>

        <div className="date-range-modal__fields">
          <label className="date-range-modal__field-row">
            <span className="date-range-modal__short-label">{LABEL_FROM}</span>
            <input
              className="field-input date-range-modal__input"
              type="date"
              lang="ru-RU"
              value={draftFrom}
              onChange={(e) => {
                setDraftFrom(e.target.value)
                setModalError('')
              }}
            />
          </label>
          <label className="date-range-modal__field-row">
            <span className="date-range-modal__short-label">{LABEL_TO}</span>
            <input
              className="field-input date-range-modal__input"
              type="date"
              lang="ru-RU"
              value={draftTo}
              onChange={(e) => {
                setDraftTo(e.target.value)
                setModalError('')
              }}
            />
          </label>
        </div>

        {modalError ? (
          <p className="date-range-modal__error error-text" role="alert">
            {modalError}
          </p>
        ) : null}

        <div className="date-range-modal__actions">
          <button
            className="confirm-modal__btn confirm-modal__btn--ghost"
            type="button"
            onClick={() => {
              setOpen(false)
              setModalError('')
            }}
          >
            Отмена
          </button>
          <button className="confirm-modal__btn confirm-modal__btn--primary" type="button" onClick={applyModal}>
            Применить
          </button>
        </div>
      </ModalDialog>
    </div>
  )
}
