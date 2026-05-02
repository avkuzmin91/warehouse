import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ActionBar } from '../components/ActionBar'
import { SimpleDictionaryFormFields } from '../components/SimpleDictionaryFormFields'
import { SystemInfoBlock, systemInfoFromApi, type SystemInfo } from '../components/SystemInfoBlock'
import {
  simpleDictionaryDefinition,
  type SimpleDictionaryEntityKey,
} from '../config/simpleDictionaryConfig'
import { getSimpleDictionaryById, updateSimpleDictionaryItem, type DictionaryItem } from '../api'

const IS_ACTIVE_LABEL = 'Актуален'

type LoadState = 'loading' | 'ok' | 'not_found' | 'error'

export type SimpleDictionaryEditPageProps = {
  entity: SimpleDictionaryEntityKey
}

export function SimpleDictionaryEditPage({ entity }: SimpleDictionaryEditPageProps) {
  const def = simpleDictionaryDefinition(entity)
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
  const basePath = `/dictionaries/${def.routeSegment}`

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

    getSimpleDictionaryById(def.apiPath, routeId)
      .then((row: DictionaryItem) => {
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
        if (msg.includes('не найден') || msg.includes('404')) {
          setLoadState('not_found')
          return
        }
        setLoadState('error')
        setLoadError(msg || def.messages.loadFailed)
      })
    return () => {
      fetchGeneration.current += 1
    }
  }, [def.apiPath, def.messages.loadFailed, routeId])

  const isPending = loadState === 'loading'
  const isFormEnabled = loadState === 'ok'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isFormEnabled || !routeId) return
    setSubmitError('')
    setTouchedName(true)
    if (nameInvalid) {
      setSubmitError(def.messages.requiredFields)
      return
    }
    try {
      await updateSimpleDictionaryItem(def.apiPath, routeId, {
        name: name.trim(),
        is_active: isActive,
      })
      navigate(basePath)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : def.messages.saveFailed)
    }
  }

  if (loadState === 'not_found') {
    return (
      <PageContainer maxWidth={640} cardClassName="product-create-card">
        <Breadcrumbs />
        <p className="error-text" style={{ marginTop: 12 }}>
          {def.messages.notFound}
        </p>
        <p style={{ marginTop: 8 }}>
          <Link className="btn btn--secondary" to={basePath}>
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
          <Link className="btn btn--secondary" to={basePath}>
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
            <Link className="product-edit-loading-back" to={basePath}>
              К списку
            </Link>
          </div>
        ) : null}

        <fieldset className="product-edit-fieldset" disabled={isPending}>
          <SimpleDictionaryFormFields
            formId={formId}
            nameLabel={def.formNameLabel}
            namePlaceholder={def.formNamePlaceholder}
            isActiveLabel={IS_ACTIVE_LABEL}
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
          onSecondary={() => navigate(basePath)}
        />
      ) : null}
    </PageContainer>
  )
}
