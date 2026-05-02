import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ActionBar } from '../components/ActionBar'
import { ClientFormFields } from '../components/ClientFormFields'
import { CLIENT_FORM_CONFIG, mapClientFormApiError } from '../config/clientFormConfig'
import { createDictionaryItem } from '../api'

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
      setSubmitError(CLIENT_FORM_CONFIG.messages.requiredFields)
      return
    }
    try {
      await createDictionaryItem('clients', {
        name: name.trim(),
        is_active: isActive,
      })
      navigate('/dictionaries/clients')
    } catch (e) {
      setSubmitError(e instanceof Error ? mapClientFormApiError(e.message) : CLIENT_FORM_CONFIG.messages.saveFailed)
    }
  }

  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
      <Breadcrumbs />

      <form id={formId} className="auth-form product-create-form" onSubmit={onSubmit} noValidate>
        <ClientFormFields
          formId={formId}
          name={name}
          onNameChange={setName}
          onNameBlur={() => setTouchedName(true)}
          isActive={isActive}
          onIsActiveChange={setIsActive}
          showNameError={showNameError}
        />
      </form>

      {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

      <ActionBar
        primaryLabel="Создать"
        submitFormId={formId}
        onSecondary={() => navigate('/dictionaries/clients')}
      />
    </PageContainer>
  )
}
