import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ActionBar } from '../components/ActionBar'
import { SystemInfoBlock, systemInfoFromApi, type SystemInfo } from '../components/SystemInfoBlock'
import {
  API_BASE_URL,
  fetchActiveDictionaryItems,
  getProduct,
  updateProduct,
  type DictionaryItem,
  type ProductItem,
} from '../api'
import {
  DictionaryFormCombobox,
  mergeDictionaryItemsWithCurrent,
} from '../components/DictionaryFormCombobox'

const REQUIRED_MSG = 'Заполните обязательные поля'
const NOT_FOUND = 'Товар не найден'

type FieldName = 'name' | 'type_id' | 'sku' | 'client_id' | 'supplier_id' | 'image' | 'is_actual'

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

export function ProductEditPage() {
  const { id: routeId = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const formId = useId()
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [productTypes, setProductTypes] = useState<DictionaryItem[]>([])
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [suppliers, setSuppliers] = useState<DictionaryItem[]>([])

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')

  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  const [sku, setSku] = useState('')
  const [clientId, setClientId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [isActual, setIsActual] = useState(true)
  const [image, setImage] = useState<File | null>(null)
  const [imageUrlFromServer, setImageUrlFromServer] = useState<string | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)

  const [loadedProduct, setLoadedProduct] = useState<ProductItem | null>(null)

  const [auditInfo, setAuditInfo] = useState<SystemInfo | null>(null)

  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitError, setSubmitError] = useState('')

  const invalid: Partial<Record<'name' | 'type_id' | 'sku' | 'client_id', boolean>> = {
    name: !name.trim(),
    type_id: typeId === '',
    sku: !sku.trim(),
    client_id: clientId.trim() === '',
  }

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

  useEffect(() => {
    if (!routeId) {
      setLoadState('not_found')
      return
    }
    let cancelled = false

    setLoadState('loading')
    setLoadError('')
    setName('')
    setTypeId('')
    setSku('')
    setClientId('')
    setSupplierId('')
    setIsActual(true)
    setImage(null)
    setImageUrlFromServer(null)
    setLoadedProduct(null)
    setAuditInfo(null)
    setSubmitError('')

    getProduct(routeId)
      .then((p: ProductItem) => {
        if (cancelled) return
        setName(p.name)
        setTypeId(p.type_id)
        setSku(p.sku)
        setClientId(p.client_id ?? '')
        setSupplierId(p.supplier_id ?? '')
        setIsActual(p.is_active)
        setImage(null)
        setImageUrlFromServer(p.image_url)
        setLoadedProduct(p)
        setAuditInfo(
          systemInfoFromApi({
            created_at: p.created_at,
            created_by: p.created_by,
            updated_at: p.updated_at,
            updated_by: p.updated_by,
          }),
        )
        setLoadState('ok')
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : ''
        if (
          msg.includes('Товар не найден') ||
          msg.includes('не найден') ||
          msg.includes('404')
        ) {
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

  const showFieldError = (key: 'name' | 'type_id' | 'sku' | 'client_id') =>
    touched[key] && invalid[key]
  const displayPreview = filePreview || (imageUrlFromServer ? `${API_BASE_URL}${imageUrlFromServer}` : null)
  const isPending = loadState === 'loading'
  const isFormEnabled = loadState === 'ok'

  const typeItems = mergeDictionaryItemsWithCurrent(
    productTypes,
    loadedProduct?.type_id,
    loadedProduct?.type_name,
  )
  const clientItems = mergeDictionaryItemsWithCurrent(
    clients,
    loadedProduct?.client_id,
    loadedProduct?.client_name,
  )
  const supplierItems = mergeDictionaryItemsWithCurrent(
    suppliers,
    loadedProduct?.supplier_id,
    loadedProduct?.supplier_name,
  )

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isFormEnabled || !routeId) return
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
      await updateProduct(routeId, {
        name: name.trim(),
        type_id: typeId,
        sku: sku.trim(),
        client_id: clientId.trim(),
        supplier_id: supplierId.trim(),
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
      <PageContainer maxWidth={640} cardClassName="product-create-card">
        <Breadcrumbs />
        <p className="error-text" style={{ marginTop: 12 }}>
          {NOT_FOUND}
        </p>
        <p style={{ marginTop: 8 }}>
          <Link className="btn btn--secondary" to="/dictionaries/products">
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
          <Link className="btn btn--secondary" to="/dictionaries/products">
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
            <Link className="product-edit-loading-back" to="/dictionaries/products">
              К списку
            </Link>
          </div>
        ) : null}

        <fieldset className="product-edit-fieldset" disabled={isPending}>
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
          <DictionaryFormCombobox
            id={`${formId}-type`}
            items={typeItems}
            value={typeId}
            onChange={setTypeId}
            disabled={isPending}
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
            aria-invalid={showFieldError('sku') ? true : undefined}
          />

          <label className="field-label" htmlFor={`${formId}-client`}>
            Клиент
            <span className="field-label__required" aria-label="обязательное поле">
              *
            </span>
          </label>
          <DictionaryFormCombobox
            id={`${formId}-client`}
            items={clientItems}
            value={clientId}
            onChange={setClientId}
            disabled={isPending}
            required
            hasError={Boolean(showFieldError('client_id'))}
            onBlur={() => setTouched((t) => ({ ...t, client_id: true }))}
          />

          <label className="field-label" htmlFor={`${formId}-supplier`}>
            Поставщик
          </label>
          <DictionaryFormCombobox
            id={`${formId}-supplier`}
            items={supplierItems}
            value={supplierId}
            onChange={setSupplierId}
            disabled={isPending}
            required={false}
            onBlur={() => setTouched((t) => ({ ...t, supplier_id: true }))}
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
                className="file-field__name file-field__name--label"
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
        </fieldset>
      </form>

      {isFormEnabled && auditInfo ? <SystemInfoBlock info={auditInfo} /> : null}

      {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

      {isFormEnabled ? (
        <ActionBar
          primaryLabel="Сохранить"
          submitFormId={formId}
          onSecondary={() => navigate('/dictionaries/products')}
        />
      ) : null}
    </PageContainer>
  )
}
