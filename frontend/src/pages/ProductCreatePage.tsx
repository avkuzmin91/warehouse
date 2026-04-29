import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { createProduct, PRODUCT_TYPE_LABELS } from '../api'
import type { ProductType } from '../api'

const REQUIRED_MSG = 'Заполните обязательные поля'

type FieldName = 'name' | 'type' | 'sku' | 'supplier' | 'image' | 'is_actual'

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
  const [name, setName] = useState('')
  const [type, setType] = useState<'' | ProductType>('')
  const [sku, setSku] = useState('')
  const [supplier, setSupplier] = useState('')
  const [isActual, setIsActual] = useState(true)
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitError, setSubmitError] = useState('')

  const invalid: Partial<Record<'name' | 'type' | 'sku', boolean>> = {
    name: !name.trim(),
    type: type === '',
    sku: !sku.trim(),
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

  const showFieldError = (key: 'name' | 'type' | 'sku') =>
    touched[key] && invalid[key]

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')
    setTouched({ name: true, type: true, sku: true, supplier: true, image: true, is_actual: true })
    if (invalid.name || invalid.type || invalid.sku) {
      setSubmitError(REQUIRED_MSG)
      return
    }
    try {
      await createProduct({
        name: name.trim(),
        type: type as ProductType,
        sku: sku.trim(),
        supplier: supplier,
        is_active: isActual,
        image: image || null,
      })
      navigate('/dictionaries/products')
    } catch (e) {
      setSubmitError(e instanceof Error ? mapProductCreateError(e.message) : 'Ошибка сохранения')
    }
  }

  return (
    <main className="page page--center">
      <section className="auth-card product-create-card">
        <Breadcrumbs />

        <form id={formId} className="auth-form product-create-form" onSubmit={onSubmit} noValidate>
          <label className="field-label" htmlFor={`${formId}-name`}>
            Название товара
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
          <select
            id={`${formId}-type`}
            className={`field-input field-input--select${showFieldError('type') ? ' field-input--error' : ''}`}
            value={type}
            onChange={(e) => setType(e.target.value as '' | ProductType)}
            onBlur={() => setTouched((t) => ({ ...t, type: true }))}
            aria-invalid={showFieldError('type')}
          >
            <option value="">— выберите —</option>
            <option value="clothes">{PRODUCT_TYPE_LABELS.clothes}</option>
            <option value="tech">{PRODUCT_TYPE_LABELS.tech}</option>
          </select>

          <label className="field-label" htmlFor={`${formId}-sku`}>
            Артикул товара
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

          <label className="field-label" htmlFor={`${formId}-supplier`}>
            Поставщик
          </label>
          <input
            id={`${formId}-supplier`}
            className="field-input"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            autoComplete="off"
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
                    : 'file-field__name file-field__name--label file-field__name--placeholder'
                }
                htmlFor={`${formId}-image`}
                title={image ? image.name : undefined}
              >
                {image ? image.name : 'Файл не выбран'}
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

          <div className="product-form-actions">
            <button className="btn btn--primary btn--form-action" type="submit">
              Сохранить
            </button>
            <button
              className="btn btn--secondary btn--form-action"
              type="button"
              onClick={() => navigate('/dictionaries/products')}
            >
              Отмена
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
