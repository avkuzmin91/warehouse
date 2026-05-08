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
import { createProductType, createSimpleDictionaryItem } from '../api'

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
  /** Новые типы товаров: учёт по цвету всегда «Да», поле недоступно для изменения. */
  const [requiresColor] = useState(true)
  const [requiresSize, setRequiresSize] = useState(false)
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
      if (entity === 'product-types') {
        await createProductType({
          name: name.trim(),
          is_active: isActive,
          requires_color: requiresColor,
          requires_size: requiresSize,
        })
      } else {
        await createSimpleDictionaryItem(def.apiPath, {
          name: name.trim(),
          is_active: isActive,
        })
      }
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
        {entity === 'product-types' ? (
          <div className="product-type-rules-block" style={{ marginTop: 12 }}>
            <p className="field-hint" style={{ marginBottom: 8 }}>
              Варианты SKU (цвет, размер)
            </p>
            <label
              className="remember product-create-remember product-create-remember--readonly"
              htmlFor={`${formId}-req-color`}
              title="Для новых типов товаров учёт по цвету всегда включён."
            >
              <input
                id={`${formId}-req-color`}
                type="checkbox"
                checked={requiresColor}
                disabled
              />
              <span className="remember__box" />
              <span className="remember__text">Учёт по цвету</span>
            </label>
            <p className="field-hint">Для каждого варианта нужно выбирать цвет из справочника</p>
            <label className="remember product-create-remember" htmlFor={`${formId}-req-size`}>
              <input
                id={`${formId}-req-size`}
                type="checkbox"
                checked={requiresSize}
                onChange={(e) => setRequiresSize(e.target.checked)}
              />
              <span className="remember__box" />
              <span className="remember__text">Учёт по размеру</span>
            </label>
            <p className="field-hint">Для каждого варианта нужно выбирать размер из справочника</p>
          </div>
        ) : null}
      </form>

      {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

      <ActionBar primaryLabel="Создать" submitFormId={formId} onSecondary={() => navigate(basePath)} />
    </PageContainer>
  )
}
