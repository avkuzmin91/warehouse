import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ActionBar } from '../components/ActionBar'
import { SystemInfoBlock, systemInfoFromApi, type SystemInfo } from '../components/SystemInfoBlock'
import {
  ProductVariantsEditor,
  type ProductVariantsEditorHandle,
} from '../components/ProductVariantsEditor'
import {
  type DictionaryItem,
  type ProductItem,
} from '../api'
import { fetchActiveDictionaryItems, getProduct, updateProduct } from '../api/adminApi'
import {
  DictionaryFormCombobox,
  mergeDictionaryItemsWithCurrent,
} from '../components/DictionaryFormCombobox'
import {
  ProductPhotoGalleryEditor,
  resolveProductGalleryForSave,
  slotsFromImageUrls,
  type ProductGallerySlot,
} from '../components/ProductPhotoGalleryEditor'

const REQUIRED_MSG = 'Заполните обязательные поля'
const NOT_FOUND = 'Товар не найден'

type FieldName = 'name' | 'sku_base' | 'client_id' | 'is_actual'

type LoadState = 'loading' | 'ok' | 'not_found' | 'error'

function mapProductUpdateError(msg: string): string {
  if (msg.includes('штрих-код') || /sku/i.test(msg) || msg.toLowerCase().includes('sku')) {
    return 'Конфликт штрих-кода'
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

  const [clients, setClients] = useState<DictionaryItem[]>([])

  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')

  const [name, setName] = useState('')
  const [skuBase, setSkuBase] = useState('')
  const [clientId, setClientId] = useState('')
  const [isActual, setIsActual] = useState(true)

  const [loadedProduct, setLoadedProduct] = useState<ProductItem | null>(null)
  const [photoSlots, setPhotoSlots] = useState<ProductGallerySlot[]>([])

  const [auditInfo, setAuditInfo] = useState<SystemInfo | null>(null)

  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitError, setSubmitError] = useState('')

  const variantsRef = useRef<ProductVariantsEditorHandle>(null)

  const invalid = {
    name: !name.trim(),
    sku_base: !skuBase.trim(),
    client_id: false,
  }

  useEffect(() => {
    let cancelled = false
    fetchActiveDictionaryItems('/clients')
      .then((cl) => {
        if (!cancelled) {
          setClients(cl)
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
    setSkuBase('')
    setClientId('')
    setIsActual(true)
    setLoadedProduct(null)
    setPhotoSlots([])
    setAuditInfo(null)
    setSubmitError('')

    getProduct(routeId)
      .then((p: ProductItem) => {
        if (cancelled) return
        setName(p.name)
        setSkuBase(p.sku_base)
        setClientId(p.client_id ?? '')
        setIsActual(p.is_active)
        setLoadedProduct(p)
        setPhotoSlots(slotsFromImageUrls(p.image_urls))
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

  const showFieldError = (key: 'name' | 'sku_base') => touched[key] && invalid[key]
  const isPending = loadState === 'loading'
  const isFormEnabled = loadState === 'ok'

  const clientItems = mergeDictionaryItemsWithCurrent(
    clients,
    loadedProduct?.client_id,
    loadedProduct?.client_name,
  )

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isFormEnabled || !routeId) return
    setSubmitError('')
    setTouched({
      name: true,
      sku_base: true,
      client_id: true,
      is_actual: true,
    })
    if (invalid.name || invalid.sku_base) {
      setSubmitError(REQUIRED_MSG)
      return
    }
    try {
      const image_urls = await resolveProductGalleryForSave(photoSlots)
      await updateProduct(routeId, {
        name: name.trim(),
        sku_base: skuBase.trim(),
        client_id: clientId.trim() || null,
        is_active: isActual,
        image_urls,
      })
      const baseSkuChanged =
        loadedProduct != null && skuBase.trim() !== loadedProduct.sku_base.trim()
      const variantResult = await variantsRef.current?.saveVariants({
        syncSkusFromServer: baseSkuChanged,
      })
      if (variantResult && !variantResult.ok) {
        setSubmitError(mapProductUpdateError(variantResult.message ?? ''))
        return
      }
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
    <PageContainer maxWidth={1100} cardClassName="product-create-card">
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
          </label>
          <input
            id={`${formId}-type`}
            className="field-input field-input--readonly"
            value={loadedProduct?.type_name ?? ''}
            readOnly
            tabIndex={-1}
            title="Тип товара нельзя изменить после создания"
          />

          <label className="field-label" htmlFor={`${formId}-sku`}>
            Штрих-код
            <span className="field-label__required" aria-label="обязательное поле">
              *
            </span>
          </label>
          <input
            id={`${formId}-sku`}
            className={`field-input${showFieldError('sku_base') ? ' field-input--error' : ''}`}
            value={skuBase}
            onChange={(e) => setSkuBase(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, sku_base: true }))}
            autoComplete="off"
            title="После сохранения штрих-коды вариантов пересчитаются автоматически (проверка уникальности на сервере)"
            aria-invalid={showFieldError('sku_base') ? true : undefined}
          />

          <label className="field-label" htmlFor={`${formId}-client`}>
            Клиент
          </label>
          <DictionaryFormCombobox
            id={`${formId}-client`}
            items={clientItems}
            value={clientId}
            onChange={setClientId}
            disabled={isPending}
            required={false}
            allowClear
            onBlur={() => setTouched((t) => ({ ...t, client_id: true }))}
          />

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

      {isFormEnabled && loadedProduct ? (
        <ProductVariantsEditor
          ref={variantsRef}
          productId={routeId}
          skuBase={skuBase}
          requiresSize={loadedProduct.requires_size}
          disabled={isPending}
          onVariantsSaved={() => {
            void getProduct(routeId).then((p) => {
              setLoadedProduct(p)
              setSkuBase(p.sku_base)
            })
          }}
        />
      ) : null}

      {isFormEnabled && loadedProduct ? (
        <ProductPhotoGalleryEditor
          slots={photoSlots}
          onSlotsChange={setPhotoSlots}
          disabled={isPending}
        />
      ) : null}

      {isFormEnabled ? (
        <ActionBar
          primaryLabel="Сохранить"
          submitFormId={formId}
          onSecondary={() => navigate('/dictionaries/products')}
        />
      ) : null}

      {submitError ? <p className="error-text product-create-error">{submitError}</p> : null}

      {isFormEnabled && auditInfo ? <SystemInfoBlock info={auditInfo} /> : null}
    </PageContainer>
  )
}
