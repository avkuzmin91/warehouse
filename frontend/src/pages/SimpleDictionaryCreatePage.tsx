import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ActionBar } from '../components/ActionBar'
import { SimpleDictionaryFormFields } from '../components/SimpleDictionaryFormFields'
import {
  simpleDictionaryDefinition,
  type SimpleDictionaryEntityKey,
} from '../config/simpleDictionaryConfig'
import { createSimpleDictionaryItem } from '../api'

const IS_ACTIVE_LABEL = 'Актуален'

export type SimpleDictionaryCreatePageProps = {
  entity: SimpleDictionaryEntityKey
}

export function SimpleDictionaryCreatePage({ entity }: SimpleDictionaryCreatePageProps) {
  const def = simpleDictionaryDefinition(entity)
  const navigate = useNavigate()
  const formId = useId()
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [touchedName, setTouchedName] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const nameInvalid = !name.trim()
  const showNameError = touchedName && nameInvalid
  const basePath = `/dictionaries/${def.routeSegment}`

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')
    setTouchedName(true)
    if (nameInvalid) {
      setSubmitError(def.messages.requiredFields)
      return
    }
    try {
      await createSimpleDictionaryItem(def.apiPath, {
        name: name.trim(),
        is_active: isActive,
      })
      navigate(basePath)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : def.messages.saveFailed)
    }
  }

  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
      <Breadcrumbs />

      <form id={formId} className="auth-form product-create-form" onSubmit={onSubmit} noValidate>
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
        />
      </form>

      {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

      <ActionBar primaryLabel="Создать" submitFormId={formId} onSecondary={() => navigate(basePath)} />
    </PageContainer>
  )
}
