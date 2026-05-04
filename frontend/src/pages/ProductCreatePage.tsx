import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { ActionBar } from '../components/ActionBar'
import { ImageFullscreenLightbox, PhotoExpandIcon } from '../components/ImageFullscreenLightbox'
import { DictionaryFormCombobox } from '../components/DictionaryFormCombobox'
import { DictionaryMultiSelect } from '../components/DictionaryMultiSelect'
import { ProductDimNumberInput } from '../components/ProductDimNumberInput'
import {
  createProduct,
  fetchActiveDictionaryItems,
  getInventoryProductTypes,
  type DictionaryItem,
  type InventoryProductTypeLookup,
} from '../api'

const REQUIRED_MSG = 'Заполните обязательные поля'

type FieldName =
  | 'name'
  | 'type_id'
  | 'sku_base'
  | 'client_id'
  | 'colors'
  | 'dimensions'
  | 'images'
  | 'is_actual'

type DimBlock = { length: string; width: string; height: string; sizes: string[] }

function isClothBlockIncomplete(b: DimBlock): boolean {
  return (
    b.length.trim() === '' ||
    b.width.trim() === '' ||
    b.height.trim() === '' ||
    b.sizes.length === 0
  )
}

function isTechBlockIncomplete(b: DimBlock): boolean {
  return b.length.trim() === '' || b.width.trim() === '' || b.height.trim() === ''
}

function mapProductCreateError(msg: string): string {
  if (msg.includes('артикул') || /sku/i.test(msg)) {
    return 'Артикул или SKU варианта уже существует'
  }
  return msg
}

function parseNum(s: string): number {
  const n = parseFloat(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function ProductDimRemoveBlockButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="users-icon-btn users-icon-btn--delete product-dim-block-remove"
      aria-label="Удалить блок габаритов"
      title="Удалить блок"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <svg className="users-icon-btn__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9 3h6M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

function ProductDimAddBlockButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="product-dim-add-block"
      aria-label="Добавить ещё один блок габаритов"
      title="Добавить ещё один блок габаритов"
      onClick={onClick}
    >
      <svg className="product-dim-add-block__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 5v14M5 12h14"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span>Ещё блок</span>
    </button>
  )
}

export function ProductCreatePage() {
  const navigate = useNavigate()
  const formId = useId()
  const imagesInputRef = useRef<HTMLInputElement>(null)

  const [productTypes, setProductTypes] = useState<DictionaryItem[]>([])
  const [typeFlags, setTypeFlags] = useState<Record<string, InventoryProductTypeLookup>>({})
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])

  const [name, setName] = useState('')
  const [typeId, setTypeId] = useState('')
  const [skuBase, setSkuBase] = useState('')
  const [clientId, setClientId] = useState('')
  const [isActual, setIsActual] = useState(true)
  const [colorIds, setColorIds] = useState<string[]>([])
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [photoDragOver, setPhotoDragOver] = useState<number | null>(null)
  const [photoDragging, setPhotoDragging] = useState<number | null>(null)
  const [photoLightboxSrc, setPhotoLightboxSrc] = useState<string | null>(null)
  const photoDragFromRef = useRef<number | null>(null)

  const [techBlocks, setTechBlocks] = useState<DimBlock[]>([
    { length: '', width: '', height: '', sizes: [] },
  ])
  const [clothBlocks, setClothBlocks] = useState<DimBlock[]>([
    { length: '', width: '', height: '', sizes: [] },
  ])

  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({})
  const [submitError, setSubmitError] = useState('')

  const requiresSize = typeId ? Boolean(typeFlags[typeId]?.requires_size) : false

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchActiveDictionaryItems('/product-types'),
      fetchActiveDictionaryItems('/clients'),
      fetchActiveDictionaryItems('/colors'),
      fetchActiveDictionaryItems('/sizes'),
      getInventoryProductTypes(),
    ])
      .then(([pt, cl, col, sz, invTypes]) => {
        if (cancelled) return
        setProductTypes(pt)
        setClients(cl)
        setColors(col)
        setSizes(sz)
        const m: Record<string, InventoryProductTypeLookup> = {}
        for (const t of invTypes) m[t.id] = t
        setTypeFlags(m)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const next = imageFiles.map((f) => URL.createObjectURL(f))
    setImagePreviews(next)
    return () => {
      for (const u of next) URL.revokeObjectURL(u)
    }
  }, [imageFiles])

  const reorderImageFiles = useCallback((from: number, to: number) => {
    if (from === to) return
    setImageFiles((fs) => {
      if (from < 0 || to < 0 || from >= fs.length || to >= fs.length) return fs
      const n = [...fs]
      const [x] = n.splice(from, 1)
      if (x === undefined) return fs
      n.splice(to, 0, x)
      return n
    })
  }, [])

  const invalid = useMemo(() => {
    const colorsOk = colorIds.length > 0
    let dimsOk = false
    if (requiresSize) {
      dimsOk = clothBlocks.every(
        (b) =>
          b.length.trim() !== '' &&
          b.width.trim() !== '' &&
          b.height.trim() !== '' &&
          b.sizes.length > 0,
      )
    } else {
      dimsOk = techBlocks.every(
        (b) => b.length.trim() !== '' && b.width.trim() !== '' && b.height.trim() !== '',
      )
    }
    return {
      name: !name.trim(),
      type_id: typeId === '',
      sku_base: !skuBase.trim(),
      client_id: !clientId.trim(),
      colors: !colorsOk,
      dimensions: !dimsOk,
    }
  }, [name, typeId, skuBase, clientId, colorIds, clothBlocks, techBlocks, requiresSize])

  const showFieldError = (key: keyof typeof invalid) => touched[key] && invalid[key]

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitError('')
    setTouched({
      name: true,
      type_id: true,
      sku_base: true,
      client_id: true,
      colors: true,
      dimensions: true,
      images: true,
      is_actual: true,
    })
    if (
      invalid.name ||
      invalid.type_id ||
      invalid.sku_base ||
      invalid.client_id ||
      invalid.colors ||
      invalid.dimensions
    ) {
      setSubmitError(REQUIRED_MSG)
      return
    }

    const dimensions = requiresSize
      ? clothBlocks.map((b) => ({
          length: parseNum(b.length),
          width: parseNum(b.width),
          height: parseNum(b.height),
          sizes: [...b.sizes],
        }))
      : techBlocks.map((b) => ({
          length: parseNum(b.length),
          width: parseNum(b.width),
          height: parseNum(b.height),
          sizes: [] as string[],
        }))

    try {
      await createProduct({
        meta: {
          product: {
            name: name.trim(),
            type_id: typeId,
            sku_base: skuBase.trim(),
            client_id: clientId.trim(),
            is_active: isActual,
          },
          colors: colorIds,
          dimensions,
        },
        images: imageFiles,
      })
      navigate('/dictionaries/products')
    } catch (e) {
      setSubmitError(e instanceof Error ? mapProductCreateError(e.message) : 'Ошибка сохранения')
    }
  }

  return (
    <PageContainer maxWidth={720} cardClassName="product-create-card">
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
          onChange={(e) => setName(e.target.value)}
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
          onChange={(v) => {
            setTypeId(v)
            if (!typeFlags[v]?.requires_size) {
              setClothBlocks([{ length: '', width: '', height: '', sizes: [] }])
            }
          }}
          required
          allowClear
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
          className={`field-input${showFieldError('sku_base') ? ' field-input--error' : ''}`}
          value={skuBase}
          onChange={(e) => setSkuBase(e.target.value)}
          onBlur={() => setTouched((t) => ({ ...t, sku_base: true }))}
          autoComplete="off"
          aria-invalid={showFieldError('sku_base')}
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
          allowClear
          hasError={Boolean(showFieldError('client_id'))}
          onBlur={() => setTouched((t) => ({ ...t, client_id: true }))}
        />

        <fieldset className="product-colors-fieldset">
          <legend className="field-label" id={`${formId}-colors-legend`}>
            Цвета
            <span className="field-label__required" aria-label="обязательное поле">
              *
            </span>
          </legend>
          <DictionaryMultiSelect
            id={`${formId}-colors-ms`}
            aria-labelledby={`${formId}-colors-legend`}
            items={colors}
            selectedIds={colorIds}
            onChange={setColorIds}
            sortMode="alphabet"
            hasError={Boolean(showFieldError('colors'))}
            onBlur={() => setTouched((t) => ({ ...t, colors: true }))}
          />
        </fieldset>

        {requiresSize ? (
          <fieldset
            className={`product-dim-fieldset${showFieldError('dimensions') ? ' product-dim-fieldset--error' : ''}`}
          >
            <legend className="field-label" id={`${formId}-dims-legend`}>
              Габариты и размеры
              <span className="field-label__required" aria-label="обязательное поле">
                *
              </span>
            </legend>
            {clothBlocks.map((block, bi) => {
              const blockErr = touched.dimensions && isClothBlockIncomplete(block)
              return (
                <div
                  key={bi}
                  className={`product-dim-block card-nested${blockErr ? ' product-dim-block--error' : ''}`}
                >
                  <div className="product-dim-block__head">
                    <p className="field-hint product-dim-block__hint">Блок {bi + 1}</p>
                    {clothBlocks.length > 1 ? (
                      <ProductDimRemoveBlockButton
                        onClick={() => setClothBlocks((arr) => arr.filter((_, j) => j !== bi))}
                      />
                    ) : null}
                  </div>
                  <div
                    className="product-dim-row"
                    onBlur={() => setTouched((t) => ({ ...t, dimensions: true }))}
                  >
                    <label className="field-label product-dim-label">Длина</label>
                    <ProductDimNumberInput
                      value={block.length}
                      onChange={(next) =>
                        setClothBlocks((arr) => {
                          const n = [...arr]
                          const cur = n[bi] ?? block
                          n[bi] = { ...cur, length: next }
                          return n
                        })
                      }
                      hasError={Boolean(touched.dimensions && block.length.trim() === '')}
                      aria-invalid={touched.dimensions && block.length.trim() === ''}
                      inputClassName={`field-input field-input--narrow${touched.dimensions && block.length.trim() === '' ? ' field-input--error' : ''}`.trim()}
                    />
                    <label className="field-label product-dim-label">Ширина</label>
                    <ProductDimNumberInput
                      value={block.width}
                      onChange={(next) =>
                        setClothBlocks((arr) => {
                          const n = [...arr]
                          const cur = n[bi] ?? block
                          n[bi] = { ...cur, width: next }
                          return n
                        })
                      }
                      hasError={Boolean(touched.dimensions && block.width.trim() === '')}
                      aria-invalid={touched.dimensions && block.width.trim() === ''}
                      inputClassName={`field-input field-input--narrow${touched.dimensions && block.width.trim() === '' ? ' field-input--error' : ''}`.trim()}
                    />
                    <label className="field-label product-dim-label">Высота</label>
                    <ProductDimNumberInput
                      value={block.height}
                      onChange={(next) =>
                        setClothBlocks((arr) => {
                          const n = [...arr]
                          const cur = n[bi] ?? block
                          n[bi] = { ...cur, height: next }
                          return n
                        })
                      }
                      hasError={Boolean(touched.dimensions && block.height.trim() === '')}
                      aria-invalid={touched.dimensions && block.height.trim() === ''}
                      inputClassName={`field-input field-input--narrow${touched.dimensions && block.height.trim() === '' ? ' field-input--error' : ''}`.trim()}
                    />
                  </div>
                  <p className="field-label" id={`${formId}-sizes-${bi}`}>
                    Размеры
                    <span className="field-label__required" aria-label="обязательное поле">
                      *
                    </span>
                  </p>
                  <DictionaryMultiSelect
                    id={`${formId}-sizes-ms-${bi}`}
                    aria-labelledby={`${formId}-sizes-${bi}`}
                    items={sizes}
                    selectedIds={block.sizes}
                    onChange={(ids) =>
                      setClothBlocks((arr) => {
                        const n = [...arr]
                        const cur = n[bi] ?? block
                        n[bi] = { ...cur, sizes: ids }
                        return n
                      })
                    }
                    sortMode="preserve"
                    hasError={Boolean(
                      touched.dimensions && requiresSize && block.sizes.length === 0,
                    )}
                    onBlur={() => setTouched((t) => ({ ...t, dimensions: true }))}
                  />
                </div>
              )
            })}
            <ProductDimAddBlockButton
              onClick={() =>
                setClothBlocks((b) => [...b, { length: '', width: '', height: '', sizes: [] }])
              }
            />
          </fieldset>
        ) : (
          <fieldset
            className={`product-dim-fieldset${showFieldError('dimensions') ? ' product-dim-fieldset--error' : ''}`}
          >
            <legend className="field-label" id={`${formId}-tech-dims-legend`}>
              Габариты (несколько блоков — варианты: цвет × блок)
              <span className="field-label__required" aria-label="обязательное поле">
                *
              </span>
            </legend>
            {techBlocks.map((block, bi) => {
              const blockErr = touched.dimensions && isTechBlockIncomplete(block)
              return (
                <div
                  key={bi}
                  className={`product-dim-block card-nested${blockErr ? ' product-dim-block--error' : ''}`}
                >
                  <div className="product-dim-block__head">
                    <p className="field-hint product-dim-block__hint">Блок {bi + 1}</p>
                    {techBlocks.length > 1 ? (
                      <ProductDimRemoveBlockButton
                        onClick={() => setTechBlocks((arr) => arr.filter((_, j) => j !== bi))}
                      />
                    ) : null}
                  </div>
                  <div
                    className="product-dim-row"
                    onBlur={() => setTouched((t) => ({ ...t, dimensions: true }))}
                  >
                    <label className="field-label product-dim-label">Длина</label>
                    <ProductDimNumberInput
                      value={block.length}
                      onChange={(next) =>
                        setTechBlocks((arr) => {
                          const n = [...arr]
                          const cur = n[bi] ?? block
                          n[bi] = { ...cur, length: next }
                          return n
                        })
                      }
                      hasError={Boolean(touched.dimensions && block.length.trim() === '')}
                      aria-invalid={touched.dimensions && block.length.trim() === ''}
                      inputClassName={`field-input field-input--narrow${touched.dimensions && block.length.trim() === '' ? ' field-input--error' : ''}`.trim()}
                    />
                    <label className="field-label product-dim-label">Ширина</label>
                    <ProductDimNumberInput
                      value={block.width}
                      onChange={(next) =>
                        setTechBlocks((arr) => {
                          const n = [...arr]
                          const cur = n[bi] ?? block
                          n[bi] = { ...cur, width: next }
                          return n
                        })
                      }
                      hasError={Boolean(touched.dimensions && block.width.trim() === '')}
                      aria-invalid={touched.dimensions && block.width.trim() === ''}
                      inputClassName={`field-input field-input--narrow${touched.dimensions && block.width.trim() === '' ? ' field-input--error' : ''}`.trim()}
                    />
                    <label className="field-label product-dim-label">Высота</label>
                    <ProductDimNumberInput
                      value={block.height}
                      onChange={(next) =>
                        setTechBlocks((arr) => {
                          const n = [...arr]
                          const cur = n[bi] ?? block
                          n[bi] = { ...cur, height: next }
                          return n
                        })
                      }
                      hasError={Boolean(touched.dimensions && block.height.trim() === '')}
                      aria-invalid={touched.dimensions && block.height.trim() === ''}
                      inputClassName={`field-input field-input--narrow${touched.dimensions && block.height.trim() === '' ? ' field-input--error' : ''}`.trim()}
                    />
                  </div>
                </div>
              )
            })}
            <ProductDimAddBlockButton
              onClick={() =>
                setTechBlocks((b) => [...b, { length: '', width: '', height: '', sizes: [] }])
              }
            />
          </fieldset>
        )}

        <label className="field-label">Фотографии</label>
        <div className="product-multi-preview" role="list" aria-label="Превью фотографий, перетаскивание меняет порядок">
          {imagePreviews.map((src, i) => {
            const f = imageFiles[i]
            const fileKey = f ? `${f.name}-${f.size}-${f.lastModified}` : `blob-${src.slice(-24)}`
            return (
              <div
                key={`photo-${i}-${fileKey}`}
                className={`product-multi-preview__card${photoDragOver === i ? ' product-multi-preview__card--over' : ''}${photoDragging === i ? ' product-multi-preview__card--dragging' : ''}`.trim()}
                role="listitem"
                draggable
                title="Перетащите, чтобы изменить порядок"
                onDragStart={(e) => {
                  photoDragFromRef.current = i
                  e.dataTransfer.setData('text/plain', String(i))
                  e.dataTransfer.effectAllowed = 'move'
                  setPhotoDragging(i)
                }}
                onDragEnd={() => {
                  photoDragFromRef.current = null
                  setPhotoDragging(null)
                  setPhotoDragOver(null)
                }}
                onDragEnter={(e) => {
                  e.preventDefault()
                  setPhotoDragOver(i)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setPhotoDragOver(i)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const from = photoDragFromRef.current
                  photoDragFromRef.current = null
                  if (from === null || Number.isNaN(from)) return
                  if (from === i) return
                  reorderImageFiles(from, i)
                  setPhotoDragging(null)
                  setPhotoDragOver(null)
                }}
              >
                <div className="product-multi-preview__frame">
                  <img src={src} alt="" className="product-create-preview__img" draggable={false} />
                </div>
                <div className="product-multi-preview__actions">
                  <button
                    type="button"
                    className="product-multi-preview__action product-multi-preview__action--delete"
                    aria-label="Удалить фото"
                    title="Удалить"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setImageFiles((fs) => fs.filter((_, j) => j !== i))
                    }}
                  >
                    <svg className="product-multi-preview__action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M9 3h6M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14"
                        stroke="currentColor"
                        strokeWidth="1.85"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="product-multi-preview__action product-multi-preview__action--expand"
                    aria-label="Открыть на весь экран"
                    title="На весь экран"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setPhotoLightboxSrc(src)
                    }}
                  >
                    <PhotoExpandIcon className="product-multi-preview__action-icon" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="product-photo-picker">
          <input
            ref={imagesInputRef}
            className="file-field__native"
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/heic,image/heif,.heic,.heif"
            multiple
            onChange={(e) => {
              const list = e.target.files ? Array.from(e.target.files) : []
              setImageFiles((prev) => [...prev, ...list])
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="product-photo-picker__btn"
            aria-label="Выбрать файлы изображений"
            title="JPG, PNG, HEIC — несколько файлов"
            onClick={() => imagesInputRef.current?.click()}
          >
            <svg className="product-photo-picker__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3"
                y="5"
                width="18"
                height="14"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <circle cx="8.5" cy="10" r="1.35" fill="currentColor" />
              <path
                d="M21 17l-4.2-4.2a1.2 1.2 0 00-1.6.05L12 15.5l-2.2-2.2a1.2 1.2 0 00-1.65 0L3 17"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Добавить фото</span>
          </button>
        </div>
        <p className="field-hint">
          Форматы: JPG, PNG, HEIC. Превью карточки — первое фото в списке; порядок можно менять перетаскиванием.
        </p>

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

      <ImageFullscreenLightbox
        open={photoLightboxSrc !== null}
        src={photoLightboxSrc}
        onClose={() => setPhotoLightboxSrc(null)}
      />

      <ActionBar
        primaryLabel="Создать"
        submitFormId={formId}
        onSecondary={() => navigate('/dictionaries/products')}
      />
    </PageContainer>
  )
}
