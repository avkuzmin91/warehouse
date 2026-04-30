import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { createDictionaryItem } from '../api'

const REQUIRED_MSG = 'Заполните обязательные поля'

function mapClientCreateError(msg: string): string {
  if (msg.includes('уже существ') || msg.includes('названием')) {
    return 'Клиент уже существует'
  }
  return msg
}

export function ClientCreatePage() {
  const navigate = useNavigate()
  const formId = useId()
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [touchedName, setTouchedName] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const nameInvalid = !name.trim()
  const showNameError = touchedName && nameInvalid

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')
    setTouchedName(true)
    if (nameInvalid) {
      setSubmitError(REQUIRED_MSG)
      return
    }
    try {
      await createDictionaryItem('clients', {
        name: name.trim(),
        is_active: isActive,
      })
      navigate('/dictionaries/clients')
    } catch (e) {
      setSubmitError(e instanceof Error ? mapClientCreateError(e.message) : 'Ошибка сохранения')
    }
  }

  return (
    <main className="page page--center">
      <section className="auth-card product-create-card">
        <Breadcrumbs />

        <form
          id={formId}
          className="auth-form product-create-form"
          onSubmit={onSubmit}
          noValidate
        >
          <label className="field-label" htmlFor={`${formId}-name`}>
            Название клиента
            <span className="field-label__required" aria-label="обязательное поле">
              *
            </span>
          </label>
          <input
            id={`${formId}-name`}
            className={`field-input${showNameError ? ' field-input--error' : ''}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
            }}
            onBlur={() => setTouchedName(true)}
            autoComplete="off"
            aria-invalid={showNameError}
          />

          <label className="remember product-create-remember" htmlFor={`${formId}-active`}>
            <input
              id={`${formId}-active`}
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span className="remember__box" />
            <span className="remember__text">Актуален</span>
          </label>

          {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

          <div className="product-form-actions">
            <button className="btn btn--primary btn--form-action" type="submit">
              Сохранить
            </button>
            <button
              className="btn btn--secondary btn--form-action"
              type="button"
              onClick={() => navigate('/dictionaries/clients')}
            >
              Отмена
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
