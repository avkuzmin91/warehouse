import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ActionBar } from '../components/ActionBar'
import { SizeFormFields } from '../components/SizeFormFields'
import { SystemInfoBlock, systemInfoFromApi, type SystemInfo } from '../components/SystemInfoBlock'
import { SIZE_FORM_CONFIG } from '../config/sizeFormConfig'
import { getSize, updateSize } from '../api'
import type { SizeItem } from '../api'

type LoadState = 'loading' | 'ok' | 'not_found' | 'error'

export function SizeEditPage() {
  const { id: routeId = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const formId = useId()
  const fetchGeneration = useRef(0)

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')

  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [auditInfo, setAuditInfo] = useState<SystemInfo | null>(null)

  const [touchedName, setTouchedName] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const nameInvalid = !name.trim()
  const showNameError = touchedName && nameInvalid

  useEffect(() => {
    if (!routeId) {
      setLoadState('not_found')
      return
    }
    const generation = ++fetchGeneration.current
    setLoadState('loading')
    setLoadError('')
    setName('')
    setIsActive(true)
    setAuditInfo(null)
    setTouchedName(false)
    setSubmitError('')

    getSize(routeId)
      .then((row: SizeItem) => {
        if (generation !== fetchGeneration.current) return
        setName(row.name)
        setIsActive(row.is_active)
        setAuditInfo(
          systemInfoFromApi({
            created_at: row.created_at,
            created_by: row.created_by,
            updated_at: row.updated_at,
            updated_by: row.updated_by,
          }),
        )
        setLoadState('ok')
      })
      .catch((e) => {
        if (generation !== fetchGeneration.current) return
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('не найдена') || msg.includes('404')) {
          setLoadState('not_found')
          return
        }
        setLoadState('error')
        setLoadError(msg || SIZE_FORM_CONFIG.messages.loadFailed)
      })
    return () => {
      fetchGeneration.current += 1
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
      setSubmitError(SIZE_FORM_CONFIG.messages.requiredFields)
      return
    }
    try {
      await updateSize(routeId, {
        name: name.trim(),
        is_active: isActive,
      })
      navigate('/dictionaries/sizes')
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : SIZE_FORM_CONFIG.messages.saveFailed)
    }
  }

  if (loadState === 'not_found') {
    return (
      <PageContainer maxWidth={640} cardClassName="product-create-card">
        <Breadcrumbs />
        <p className="error-text" style={{ marginTop: 12 }}>
          {SIZE_FORM_CONFIG.messages.notFound}
        </p>
        <p style={{ marginTop: 8 }}>
          <Link className="btn btn--secondary" to="/dictionaries/sizes">
            Назад
          </Link>
        </p>
      </PageContainer>
    )
  }

  if (loadState === 'error') {
    return (
      <PageContainer maxWidth={640} cardClassName="product-create-card">
        <Breadcrumbs />
        <p className="error-text" style={{ marginTop: 12 }}>
          {loadError}
        </p>
        <p style={{ marginTop: 8 }}>
          <Link className="btn btn--secondary" to="/dictionaries/sizes">
            Назад
          </Link>
        </p>
      </PageContainer>
    )
  }

  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
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
            <Link className="product-edit-loading-back" to="/dictionaries/sizes">
              К списку
            </Link>
          </div>
        ) : null}

        <fieldset className="product-edit-fieldset" disabled={isPending}>
          <SizeFormFields
            formId={formId}
            name={name}
            onNameChange={setName}
            onNameBlur={() => setTouchedName(true)}
            isActive={isActive}
            onIsActiveChange={setIsActive}
            showNameError={showNameError}
            disabled={isPending}
          />
        </fieldset>
      </form>

      {isFormEnabled && auditInfo ? <SystemInfoBlock info={auditInfo} /> : null}

      {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

      {isFormEnabled ? (
        <ActionBar
          primaryLabel="Сохранить"
          submitFormId={formId}
          onSecondary={() => navigate('/dictionaries/sizes')}
        />
      ) : null}
    </PageContainer>
  )
}
