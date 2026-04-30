import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { getDictionaryItem, updateDictionaryItem } from '../api'
import type { DictionaryItem } from '../api'

const REQUIRED_MSG = 'Заполните обязательные поля'
const NOT_FOUND = 'Клиент не найден'

type LoadState = 'loading' | 'ok' | 'not_found' | 'error'

function mapClientUpdateError(msg: string): string {
  if (msg.includes('уже существ') || msg.includes('названием')) {
    return 'Клиент уже существует'
  }
  return msg
}

function formatLineDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ClientEditPage() {
  const { id: routeId = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const formId = useId()

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')

  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [creator, setCreator] = useState<string | null>(null)
  const [editor, setEditor] = useState<string | null>(null)

  const [touchedName, setTouchedName] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const nameInvalid = !name.trim()
  const showNameError = touchedName && nameInvalid

  useEffect(() => {
    if (!routeId) {
      setLoadState('not_found')
      return
    }
    let cancelled = false

    setLoadState('loading')
    setLoadError('')
    setName('')
    setIsActive(true)
    setCreatedAt(null)
    setUpdatedAt(null)
    setCreator(null)
    setEditor(null)
    setTouchedName(false)
    setSubmitError('')

    getDictionaryItem('clients', routeId)
      .then((row: DictionaryItem) => {
        if (cancelled) return
        setName(row.name)
        setIsActive(row.is_active)
        setCreatedAt(row.created_at)
        setUpdatedAt(row.updated_at)
        setCreator(row.creator)
        setEditor(row.editor)
        setLoadState('ok')
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('не найдена') || msg.includes('404')) {
          setLoadState('not_found')
          return
        }
        setLoadState('error')
        setLoadError(msg || 'Ошибка загрузки')
      })
    return () => {
      cancelled = true
    }
  }, [routeId])

  const isPending = loadState === 'loading'
  const isFormEnabled = loadState === 'ok'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isFormEnabled || !routeId) return
    setSubmitError('')
    setTouchedName(true)
    if (nameInvalid) {
      setSubmitError(REQUIRED_MSG)
      return
    }
    try {
      await updateDictionaryItem('clients', routeId, {
        name: name.trim(),
        is_active: isActive,
      })
      navigate('/dictionaries/clients')
    } catch (e) {
      setSubmitError(e instanceof Error ? mapClientUpdateError(e.message) : 'Ошибка сохранения')
    }
  }

  if (loadState === 'not_found') {
    return (
      <main className="page page--center">
        <section className="auth-card product-create-card">
          <Breadcrumbs />
          <p className="error-text" style={{ marginTop: 12 }}>
            {NOT_FOUND}
          </p>
          <p style={{ marginTop: 8 }}>
            <Link className="btn btn--secondary" to="/dictionaries/clients">
              Назад
            </Link>
          </p>
        </section>
      </main>
    )
  }

  if (loadState === 'error') {
    return (
      <main className="page page--center">
        <section className="auth-card product-create-card">
          <Breadcrumbs />
          <p className="error-text" style={{ marginTop: 12 }}>
            {loadError}
          </p>
          <p style={{ marginTop: 8 }}>
            <Link className="btn btn--secondary" to="/dictionaries/clients">
              Назад
            </Link>
          </p>
        </section>
      </main>
    )
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
          aria-busy={isPending}
        >
          {isPending ? (
            <div className="product-edit-loading-banner" role="status" aria-live="polite">
              <span className="product-edit-spinner" aria-hidden />
              <span>Загрузка…</span>
              <Link className="product-edit-loading-back" to="/dictionaries/clients">
                К списку
              </Link>
            </div>
          ) : null}

          <fieldset className="product-edit-fieldset" disabled={isPending}>
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
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouchedName(true)}
              autoComplete="off"
              aria-invalid={showNameError ? true : undefined}
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
          </fieldset>

          {isFormEnabled ? (
            <div
              className="product-meta-block product-meta-block--record"
              role="group"
              aria-label="Информация о записи"
            >
              <p className="product-meta-block__title">Информация о записи</p>
              <ul className="product-record-meta" role="list">
                <li>
                  <span className="product-record-meta__k">Создано</span>
                  <span className="product-record-meta__v">{formatLineDateTime(createdAt)}</span>
                </li>
                <li>
                  <span className="product-record-meta__k">Создал</span>
                  <span className="product-record-meta__v">{creator || '—'}</span>
                </li>
                <li>
                  <span className="product-record-meta__k">Последнее изменение</span>
                  <span className="product-record-meta__v">{formatLineDateTime(updatedAt)}</span>
                </li>
                <li>
                  <span className="product-record-meta__k">Изменил</span>
                  <span className="product-record-meta__v">{editor || '—'}</span>
                </li>
              </ul>
            </div>
          ) : null}

          {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

          {isFormEnabled ? (
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
          ) : null}
        </form>
      </section>
    </main>
  )
}
