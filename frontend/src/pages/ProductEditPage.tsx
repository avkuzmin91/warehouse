import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { API_BASE_URL, getProduct, PRODUCT_TYPE_LABELS, updateProduct } from '../api'
import type { ProductItem, ProductType } from '../api'

const REQUIRED_MSG = 'Заполните обязательные поля'
const NOT_FOUND = 'Товар не найден'

type FieldName = 'name' | 'type' | 'sku' | 'supplier' | 'image' | 'is_actual'

type LoadState = 'loading' | 'ok' | 'not_found' | 'error'

function mapProductUpdateError(msg: string): string {
  if (msg.includes('артикулом') || /sku/i.test(msg) || msg.toLowerCase().includes('sku')) {
    return 'SKU уже существует'
  }
  if (msg.includes('Нет данных')) {
    return 'Нет данных для обновления'
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

export function ProductEditPage() {
  const { id: routeId = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const formId = useId()
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')

  const [name, setName] = useState('')
  const [type, setType] = useState<'' | ProductType>('')
  const [sku, setSku] = useState('')
  const [supplier, setSupplier] = useState('')
  const [isActual, setIsActual] = useState(true)
  const [image, setImage] = useState<File | null>(null)
  const [imageUrlFromServer, setImageUrlFromServer] = useState<string | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)

  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [createdBy, setCreatedBy] = useState<string | null>(null)
  const [updatedBy, setUpdatedBy] = useState<string | null>(null)

  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitError, setSubmitError] = useState('')

  const invalid: Partial<Record<'name' | 'type' | 'sku', boolean>> = {
    name: !name.trim(),
    type: type === '',
    sku: !sku.trim(),
  }

  useEffect(() => {
    if (!routeId) {
      setLoadState('not_found')
      return
    }
    let cancelled = false

    setLoadState('loading')
    setLoadError('')
    setName('')
    setType('')
    setSku('')
    setSupplier('')
    setIsActual(true)
    setImage(null)
    setImageUrlFromServer(null)
    setCreatedAt(null)
    setUpdatedAt(null)
    setCreatedBy(null)
    setUpdatedBy(null)
    setSubmitError('')

    getProduct(routeId)
      .then((p: ProductItem) => {
        if (cancelled) return
        setName(p.name)
        setType(p.type)
        setSku(p.sku)
        setSupplier(p.supplier || '')
        setIsActual(p.is_active)
        setImage(null)
        setImageUrlFromServer(p.image_url)
        setCreatedAt(p.created_at)
        setUpdatedAt(p.updated_at)
        setCreatedBy(p.created_by)
        setUpdatedBy(p.updated_by)
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

  useEffect(() => {
    if (!image) {
      setFilePreview((p) => {
        if (p) URL.revokeObjectURL(p)
        return null
      })
      return
    }
    const url = URL.createObjectURL(image)
    setFilePreview((p) => {
      if (p) URL.revokeObjectURL(p)
      return url
    })
  }, [image])

  const showFieldError = (key: 'name' | 'type' | 'sku') => touched[key] && invalid[key]
  const displayPreview = filePreview || (imageUrlFromServer ? `${API_BASE_URL}${imageUrlFromServer}` : null)
  const isPending = loadState === 'loading'
  const isFormEnabled = loadState === 'ok'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isFormEnabled || !routeId) return
    setSubmitError('')
    setTouched({ name: true, type: true, sku: true, supplier: true, image: true, is_actual: true })
    if (invalid.name || invalid.type || invalid.sku) {
      setSubmitError(REQUIRED_MSG)
      return
    }
    try {
      await updateProduct(routeId, {
        name: name.trim(),
        type: type as ProductType,
        sku: sku.trim(),
        supplier,
        is_active: isActual,
        image: image || undefined,
      })
      navigate('/dictionaries/products')
    } catch (e) {
      setSubmitError(e instanceof Error ? mapProductUpdateError(e.message) : 'Ошибка сохранения')
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
            <Link className="btn btn--secondary" to="/dictionaries/products">
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
            <Link className="btn btn--secondary" to="/dictionaries/products">
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
              <Link className="product-edit-loading-back" to="/dictionaries/products">
                К списку
              </Link>
            </div>
          ) : null}

          <fieldset
            className="product-edit-fieldset"
            disabled={isPending}
          >
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
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              autoComplete="off"
              aria-invalid={showFieldError('name') ? true : undefined}
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
              aria-invalid={showFieldError('type') ? true : undefined}
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
              aria-invalid={showFieldError('sku') ? true : undefined}
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
            {displayPreview ? (
              <div className="product-create-preview">
                <img src={displayPreview} alt="Превью" className="product-create-preview__img" />
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
                  {image ? image.name : 'Файл не выбран (оставьте пустым, чтобы не менять фото)'}
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
                  <span className="product-record-meta__v">{createdBy || '—'}</span>
                </li>
                <li>
                  <span className="product-record-meta__k">Последнее изменение</span>
                  <span className="product-record-meta__v">{formatLineDateTime(updatedAt)}</span>
                </li>
                <li>
                  <span className="product-record-meta__k">Изменил</span>
                  <span className="product-record-meta__v">{updatedBy || '—'}</span>
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
                onClick={() => navigate('/dictionaries/products')}
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
