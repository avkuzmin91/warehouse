import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ActionBar } from '../components/ActionBar'
import { DictionaryFormCombobox } from '../components/DictionaryFormCombobox'
import { createProduct, fetchActiveDictionaryItems, type DictionaryItem } from '../api'

const REQUIRED_MSG = 'Заполните обязательные поля'

type FieldName = 'name' | 'type_id' | 'sku' | 'client_id' | 'supplier_id' | 'image' | 'is_actual'

function mapProductCreateError(msg: string): string {
  if (msg.includes('артикулом') || /sku/i.test(msg)) {
    return 'SKU уже существует'
  }
  return msg
}

export function ProductCreatePage() {
  const navigate = useNavigate()
  const formId = useId()
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [productTypes, setProductTypes] = useState<DictionaryItem[]>([])
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [suppliers, setSuppliers] = useState<DictionaryItem[]>([])

  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  const [sku, setSku] = useState('')
  const [clientId, setClientId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [isActual, setIsActual] = useState(true)
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchActiveDictionaryItems('/product-types'),
      fetchActiveDictionaryItems('/clients'),
      fetchActiveDictionaryItems('/suppliers'),
    ])
      .then(([pt, cl, sup]) => {
        if (!cancelled) {
          setProductTypes(pt)
          setClients(cl)
          setSuppliers(sup)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const invalid: Partial<Record<'name' | 'type_id' | 'sku' | 'client_id', boolean>> = {
    name: !name.trim(),
    type_id: typeId === '',
    sku: !sku.trim(),
    client_id: clientId.trim() === '',
  }

  useEffect(() => {
    if (!image) {
      setImagePreview((p) => {
        if (p) URL.revokeObjectURL(p)
        return null
      })
      return
    }
    const url = URL.createObjectURL(image)
    setImagePreview((p) => {
      if (p) URL.revokeObjectURL(p)
      return url
    })
  }, [image])

  const showFieldError = (key: 'name' | 'type_id' | 'sku' | 'client_id') =>
    touched[key] && invalid[key]

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')
    setTouched({
      name: true,
      type_id: true,
      sku: true,
      client_id: true,
      supplier_id: true,
      image: true,
      is_actual: true,
    })
    if (invalid.name || invalid.type_id || invalid.sku || invalid.client_id) {
      setSubmitError(REQUIRED_MSG)
      return
    }
    try {
      await createProduct({
        name: name.trim(),
        type_id: typeId,
        sku: sku.trim(),
        client_id: clientId.trim(),
        supplier_id: supplierId.trim() || null,
        is_active: isActual,
        image: image || null,
      })
      navigate('/dictionaries/products')
    } catch (e) {
      setSubmitError(e instanceof Error ? mapProductCreateError(e.message) : 'Ошибка сохранения')
    }
  }

  return (
    <PageContainer maxWidth={640} cardClassName="product-create-card">
      <Breadcrumbs />

      <form id={formId} className="auth-form product-create-form" onSubmit={onSubmit} noValidate>
        <label className="field-label" htmlFor={`${formId}-name`}>
          Название
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <input
          id={`${formId}-name`}
          className={`field-input${showFieldError('name') ? ' field-input--error' : ''}`}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
          }}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
          autoComplete="off"
          aria-invalid={showFieldError('name')}
        />

        <label className="field-label" htmlFor={`${formId}-type`}>
          Тип товара
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <DictionaryFormCombobox
          id={`${formId}-type`}
          items={productTypes}
          value={typeId}
          onChange={setTypeId}
          required
          hasError={Boolean(showFieldError('type_id'))}
          onBlur={() => setTouched((t) => ({ ...t, type_id: true }))}
        />

        <label className="field-label" htmlFor={`${formId}-sku`}>
          Артикул
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <input
          id={`${formId}-sku`}
          className={`field-input${showFieldError('sku') ? ' field-input--error' : ''}`}
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, sku: true }))}
          autoComplete="off"
          aria-invalid={showFieldError('sku')}
        />

        <label className="field-label" htmlFor={`${formId}-client`}>
          Клиент
          <span className="field-label__required" aria-label="обязательное поле">
            *
          </span>
        </label>
        <DictionaryFormCombobox
          id={`${formId}-client`}
          items={clients}
          value={clientId}
          onChange={setClientId}
          required
          hasError={Boolean(showFieldError('client_id'))}
          onBlur={() => setTouched((t) => ({ ...t, client_id: true }))}
        />

        <label className="field-label" htmlFor={`${formId}-supplier`}>
          Поставщик
        </label>
        <DictionaryFormCombobox
          id={`${formId}-supplier`}
          items={suppliers}
          value={supplierId}
          onChange={setSupplierId}
          required={false}
          onBlur={() => setTouched((t) => ({ ...t, supplier_id: true }))}
        />

        <label className="field-label" htmlFor={`${formId}-image`}>
          Фотография
        </label>
        {imagePreview ? (
          <div className="product-create-preview">
            <img src={imagePreview} alt="Превью выбранного файла" className="product-create-preview__img" />
          </div>
        ) : null}
        <div className="file-field file-field--product">
          <div className="file-field__row">
            <label
              className={
                image
                  ? 'file-field__name file-field__name--label'
                  : 'file-field__name file-field__name--label'
              }
              htmlFor={`${formId}-image`}
              title={image ? image.name : undefined}
            >
              {image ? image.name : '\u00A0'}
            </label>
            <button
              type="button"
              className="file-field__icon-btn"
              aria-label="Выбрать файл изображения"
              onClick={() => imageInputRef.current?.click()}
            >
              <svg
                className="file-field__icon"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
              >
                <path
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <input
            ref={imageInputRef}
            id={`${formId}-image`}
            className="file-field__native"
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/heic,image/heif,.heic,.heif"
            onChange={(e) => setImage(e.target.files?.[0] || null)}
          />
        </div>
        <p className="field-hint">Форматы: JPG, PNG, HEIC</p>

        <label className="remember product-create-remember" htmlFor={`${formId}-na`}>
          <input
            id={`${formId}-na`}
            type="checkbox"
            checked={isActual}
            onChange={(e) => setIsActual(e.target.checked)}
          />
          <span className="remember__box"></span>
          <span className="remember__text">Актуален</span>
        </label>

        {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}
      </form>

      <ActionBar
        primaryLabel="Создать"
        submitFormId={formId}
        onSecondary={() => navigate('/dictionaries/products')}
      />
    </PageContainer>
  )
}
