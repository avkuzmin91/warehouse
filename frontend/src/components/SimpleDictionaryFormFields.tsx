export type SimpleDictionaryFormFieldsProps = {
  formId: string
  nameLabel: string
  namePlaceholder: string
  isActiveLabel: string
  name: string
  onNameChange: (value: string) => void
  onNameBlur?: () => void
  isActive: boolean
  onIsActiveChange: (value: boolean) => void
  showNameError: boolean
  disabled?: boolean
  readOnly?: boolean
}

export function SimpleDictionaryFormFields({
  formId,
  nameLabel,
  namePlaceholder,
  isActiveLabel,
  name,
  onNameChange,
  onNameBlur,
  isActive,
  onIsActiveChange,
  showNameError,
  disabled = false,
  readOnly = false,
}: SimpleDictionaryFormFieldsProps) {
  const nameId = `${formId}-name`
  const activeId = `${formId}-active`

  if (readOnly) {
    return (
      <div className="client-form-fields client-form-fields--readonly">
        <div className="field-label">{nameLabel}</div>
        <p className="client-form-fields__readonly-value">{name || '—'}</p>
        <div className="remember product-create-remember client-form-fields__readonly-flag">
          <input id={activeId} type="checkbox" checked={isActive} disabled tabIndex={-1} />
          <span className="remember__box" />
          <span className="remember__text">{isActiveLabel}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <label className="field-label" htmlFor={nameId}>
        {nameLabel}
        <span className="field-label__required" aria-label="обязательное поле">
          *
        </span>
      </label>
      <input
        id={nameId}
        className={`field-input${showNameError ? ' field-input--error' : ''}`}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onBlur={onNameBlur}
        placeholder={namePlaceholder}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={showNameError ? true : undefined}
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
        <span className="remember__text">{isActiveLabel}</span>
      </label>
    </>
  )
}
