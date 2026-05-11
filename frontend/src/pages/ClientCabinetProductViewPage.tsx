import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ImageFullscreenLightbox } from '../components/ImageFullscreenLightbox'
import {
  getClientPortalColors,
  getClientPortalProduct,
  getClientPortalProductVariants,
  getClientPortalSizes,
  resolvePublicUploadSrc,
  type DictionaryItem,
  type ProductItem,
  type ProductVariantItem,
} from '../api'
import { Table, type TableColumn } from '../components/Table'

type LoadState = 'loading' | 'ok' | 'not_found' | 'error'

const NOT_FOUND = 'Товар не найден'
const VIEW_FORM_ID = 'cabinet-product-view'
const GALLERY_THUMB_PX = 100

function BackToProductListLink({ className = '' }: { className?: string }) {
  return (
    <Link
      className={['btn', 'btn--secondary', 'btn--form-action', className].filter(Boolean).join(' ')}
      to="/cabinet/products"
    >
      Назад
    </Link>
  )
}

function dictName(items: DictionaryItem[], id: string): string {
  const row = items.find((i) => i.id === id)
  return row?.name?.trim() ? row.name : id
}

export function ClientCabinetProductViewPage() {
  const { id: routeId = '' } = useParams<{ id: string }>()
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [product, setProduct] = useState<ProductItem | null>(null)
  const [variants, setVariants] = useState<ProductVariantItem[]>([])
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getClientPortalColors(), getClientPortalSizes()])
      .then(([c, s]) => {
        if (!cancelled) {
          setColors(c)
          setSizes(s)
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
    setProduct(null)
    setVariants([])
    setLightboxSrc(null)

    Promise.all([getClientPortalProduct(routeId), getClientPortalProductVariants(routeId)])
      .then(([p, v]) => {
        if (cancelled) return
        setProduct(p)
        setVariants(v)
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

  const variantColumns = useMemo<TableColumn<ProductVariantItem>[]>(
    () => [
      {
        key: 'color_id',
        title: 'Цвет',
        sortable: false,
        render: (_, row) => dictName(colors, row.color_id),
      },
      {
        key: 'size_id',
        title: 'Размер',
        sortable: false,
        render: (_, row) => (row.size_id ? dictName(sizes, row.size_id) : '—'),
      },
      {
        key: 'dim',
        title: 'Д×Ш×В, см',
        sortable: false,
        render: (_, row) => {
          const d = row.dimension
          return `${d.length}×${d.width}×${d.height}`
        },
      },
    ],
    [colors, sizes],
  )

  if (loadState === 'not_found') {
    return (
      <div className="cabinet-product-view-root cabinet-product-view-root--message">
        <p className="error-text" style={{ marginTop: 0 }}>
          {NOT_FOUND}
        </p>
        <div className="product-form-actions action-bar" style={{ marginTop: 12 }}>
          <div className="action-bar__trailing">
            <BackToProductListLink />
          </div>
        </div>
      </div>
    )
  }

  if (loadState === 'error') {
    return (
      <div className="cabinet-product-view-root cabinet-product-view-root--message">
        <p className="error-text" style={{ marginTop: 0 }}>
          {loadError}
        </p>
        <div className="product-form-actions action-bar" style={{ marginTop: 12 }}>
          <div className="action-bar__trailing">
            <BackToProductListLink />
          </div>
        </div>
      </div>
    )
  }

  const pending = loadState === 'loading'
  const p = product

  return (
    <div className="cabinet-product-view-root">
      {pending ? (
        <div className="product-edit-loading-banner" role="status" aria-live="polite">
          <span className="product-edit-spinner" aria-hidden />
          <span>Загрузка…</span>
          <BackToProductListLink className="product-edit-loading-banner__back" />
        </div>
      ) : null}

      {p && !pending ? (
        <>
          <div className="auth-form product-create-form">
            <fieldset className="product-edit-fieldset">
              <label className="field-label" htmlFor={`${VIEW_FORM_ID}-name`}>
                Название
              </label>
              <input
                id={`${VIEW_FORM_ID}-name`}
                className="field-input field-input--readonly"
                readOnly
                tabIndex={-1}
                value={p.name}
              />

              <label className="field-label" htmlFor={`${VIEW_FORM_ID}-type`}>
                Тип товара
              </label>
              <input
                id={`${VIEW_FORM_ID}-type`}
                className="field-input field-input--readonly"
                readOnly
                tabIndex={-1}
                value={p.type_name ?? ''}
              />

              <label className="field-label" htmlFor={`${VIEW_FORM_ID}-sku`}>
                Штрих-код
              </label>
              <input
                id={`${VIEW_FORM_ID}-sku`}
                className="field-input field-input--readonly"
                readOnly
                tabIndex={-1}
                value={p.sku_base}
              />

              <label className="field-label" htmlFor={`${VIEW_FORM_ID}-client`}>
                Клиент
              </label>
              <input
                id={`${VIEW_FORM_ID}-client`}
                className="field-input field-input--readonly"
                readOnly
                tabIndex={-1}
                value={p.client_name ?? '—'}
              />

              <label className="field-label" htmlFor={`${VIEW_FORM_ID}-na`}>
                Актуален
              </label>
              <input
                id={`${VIEW_FORM_ID}-na`}
                className="field-input field-input--readonly"
                readOnly
                tabIndex={-1}
                value={p.is_active ? 'Да' : 'Нет'}
              />

              {p.image_urls && p.image_urls.length > 0 ? (
                <>
                  <span className="field-label" id={`${VIEW_FORM_ID}-photos-label`}>
                    Фото
                  </span>
                  <div
                    className="client-product-view__gallery"
                    role="group"
                    aria-labelledby={`${VIEW_FORM_ID}-photos-label`}
                  >
                    {p.image_urls.map((url, idx) => {
                      const src = resolvePublicUploadSrc(url)
                      return (
                        <button
                          key={`${idx}:${url}`}
                          type="button"
                          className="client-product-view__thumb-btn"
                          onClick={() => setLightboxSrc(src)}
                          aria-label="Открыть фото крупно"
                        >
                          <img
                            src={src}
                            alt=""
                            className="client-product-view__img"
                            width={GALLERY_THUMB_PX}
                            height={GALLERY_THUMB_PX}
                            loading="lazy"
                            decoding="async"
                          />
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </fieldset>
          </div>

          <div className="product-variants-editor">
            <h2 className="product-variants-editor__title">Варианты товара</h2>
            <Table<ProductVariantItem>
              columns={variantColumns}
              data={variants}
              loading={false}
              wrapClassName="product-table-wrap"
            />
          </div>

          <div className="product-form-actions action-bar">
            <div className="action-bar__trailing">
              <BackToProductListLink />
            </div>
          </div>
        </>
      ) : null}

      <ImageFullscreenLightbox
        open={lightboxSrc !== null}
        src={lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />
    </div>
  )
}
