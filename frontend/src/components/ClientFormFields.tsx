import { CLIENT_FORM_CONFIG } from '../config/clientFormConfig'

export type ClientFormFieldsProps = {
  /** Префикс id из useId() */
  formId: string
  name: string
  onNameChange: (value: string) => void
  onNameBlur?: () => void
  isActive: boolean
  onIsActiveChange: (value: boolean) => void
  showNameError: boolean
  disabled?: boolean
  /** Режим просмотра (view): только чтение */
  readOnly?: boolean
}

/**
 * Поля формы клиента по ТЗ Client Form (name + is_active).
 * Используется на страницах создания и редактирования; при readOnly — для view.
 */
export function ClientFormFields({
  formId,
  name,
  onNameChange,
  onNameBlur,
  isActive,
  onIsActiveChange,
  showNameError,
  disabled = false,
  readOnly = false,
}: ClientFormFieldsProps) {
  const nameId = `${formId}-name`
  const activeId = `${formId}-active`
  const nameInvalid = showNameError

  if (readOnly) {
    return (
      <div className="client-form-fields client-form-fields--readonly">
        <div className="field-label">{CLIENT_FORM_CONFIG.name.label}</div>
        <p className="client-form-fields__readonly-value">{name || '—'}</p>
        <div className="remember product-create-remember client-form-fields__readonly-flag">
          <input id={activeId} type="checkbox" checked={isActive} disabled tabIndex={-1} />
          <span className="remember__box" />
          <span className="remember__text">{CLIENT_FORM_CONFIG.isActive.label}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <label className="field-label" htmlFor={nameId}>
        {CLIENT_FORM_CONFIG.name.label}
        <span className="field-label__required" aria-label="обязательное поле">
          *
        </span>
      </label>
      <input
        id={nameId}
        className={`field-input${nameInvalid ? ' field-input--error' : ''}`}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onBlur={onNameBlur}
        placeholder={CLIENT_FORM_CONFIG.name.placeholder}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={nameInvalid ? true : undefined}
      />

      <label className="remember product-create-remember" htmlFor={activeId}>
        <input
          id={activeId}
          type="checkbox"
          checked={isActive}
          onChange={(e) => onIsActiveChange(e.target.checked)}
          disabled={disabled}
        />
        <span className="remember__box" />
        <span className="remember__text">{CLIENT_FORM_CONFIG.isActive.label}</span>
      </label>
    </>
  )
}
