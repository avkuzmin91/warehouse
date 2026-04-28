import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  API_BASE_URL,
  PRODUCT_TYPE_LABELS,
  createDictionaryItem,
  createProduct,
  deleteDictionaryItem,
  deleteProduct,
  getDictionary,
  getDictionaryItem,
  getProduct,
  getProducts,
  updateDictionaryItem,
  updateProduct,
} from '../api'
import type { DictionaryItem, ProductItem, ProductType } from '../api'

type DictionaryKind = 'clients' | 'colors' | 'sizes' | 'products'
type BasicKind = 'clients' | 'colors' | 'sizes'

const sections: { key: DictionaryKind; label: string }[] = [
  { key: 'clients', label: 'Клиенты' },
  { key: 'colors', label: 'Цвета' },
  { key: 'sizes', label: 'Размеры' },
  { key: 'products', label: 'Товары' },
]

const dictionaryMeta: Record<
  DictionaryKind,
  { label: string; listTitle: string; cardTitle: string; createTitle: string; nameLabel: string }
> = {
  clients: {
    label: 'Клиенты',
    listTitle: 'Справочник клиентов',
    cardTitle: 'Карточка клиента',
    createTitle: 'Создание клиента',
    nameLabel: 'Название',
  },
  colors: {
    label: 'Цвета',
    listTitle: 'Справочник цветов',
    cardTitle: 'Карточка цвета',
    createTitle: 'Создание цвета',
    nameLabel: 'Название',
  },
  sizes: {
    label: 'Размеры',
    listTitle: 'Справочник размеров',
    cardTitle: 'Карточка размера',
    createTitle: 'Создание размера',
    nameLabel: 'Название',
  },
  products: {
    label: 'Товары',
    listTitle: 'Справочник товаров',
    cardTitle: 'Карточка товара',
    createTitle: 'Создание товара',
    nameLabel: 'Название товара',
  },
}

function formatDateDdMmYyyy(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function DictionariesPage() {
  const navigate = useNavigate()
  const { section = 'clients', itemId } = useParams<{ section: DictionaryKind; itemId?: string }>()
  const activeSection = section as DictionaryKind
  const isProducts = activeSection === 'products'
  const isCreateMode = itemId === 'new'
  const isEditMode = Boolean(itemId && itemId !== 'new')

  const [items, setItems] = useState<DictionaryItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [productsTotal, setProductsTotal] = useState(0)
  const [productPage, setProductPage] = useState(1)
  const [productLimit, setProductLimit] = useState<20 | 50 | 100>(20)
  const [error, setError] = useState('')

  const [dictForm, setDictForm] = useState({ name: '', is_not_actual: false })
  /** true = товар актуален (is_active) */
  const [productForm, setProductForm] = useState({
    name: '',
    type: 'clothes' as ProductType,
    sku: '',
    supplier: '',
    is_actual: true,
    image: null as File | null,
    image_url: null as string | null,
  })

  const [meta, setMeta] = useState<{
    created_at: string
    creator: string | null
    updated_at: string | null
    editor: string | null
  } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    text: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const currentMeta = useMemo(() => dictionaryMeta[activeSection], [activeSection])

  useEffect(() => {
    setError('')
    setMeta(null)
    if (!isCreateMode && !isEditMode) {
      if (!isProducts) {
        getDictionary(activeSection as BasicKind)
          .then(setItems)
          .catch((requestError) =>
            setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки'),
          )
      } else {
        getProducts({ page: productPage, limit: productLimit })
          .then((res) => {
            setProducts(res.items)
            setProductsTotal(res.total)
            const lastPage = Math.max(1, Math.ceil(res.total / productLimit) || 1)
            if (res.total > 0 && productPage > lastPage) {
              setProductPage(lastPage)
            }
          })
          .catch((requestError) =>
            setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки'),
          )
      }
      return
    }

    if (isCreateMode) {
      if (!isProducts) {
        setDictForm({ name: '', is_not_actual: false })
      }
      return
    }

    if (!itemId) return
    if (!isProducts) {
      getDictionaryItem(activeSection as BasicKind, itemId)
        .then((item) => {
          setDictForm({ name: item.name, is_not_actual: item.is_active })
          setMeta(item)
        })
        .catch((requestError) =>
          setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки'),
        )
    } else {
      getProduct(itemId)
        .then((item) => {
          setProductForm({
            name: item.name,
            type: item.type,
            sku: item.sku,
            supplier: item.supplier || '',
            is_actual: item.is_active,
            image: null,
            image_url: item.image_url,
          })
          setMeta(item)
        })
        .catch((requestError) =>
          setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки'),
        )
    }
  }, [activeSection, isProducts, isCreateMode, isEditMode, itemId, productPage, productLimit])

  async function onSaveDictionary(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const payload = { name: dictForm.name, is_active: dictForm.is_not_actual }
      if (isEditMode && itemId) {
        setConfirmDialog({
          text: 'Данные в карточках будут заменены',
          onConfirm: async () => {
            await updateDictionaryItem(activeSection as BasicKind, itemId, payload)
            navigate(`/dictionaries/${activeSection}`)
          },
        })
        return
      }
      await createDictionaryItem(activeSection as BasicKind, payload)
      navigate(`/dictionaries/${activeSection}`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Ошибка сохранения')
    }
  }

  async function onSaveProduct(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      if (isEditMode && itemId) {
        setConfirmDialog({
          text: 'Данные в карточках будут заменены',
          onConfirm: async () => {
            await updateProduct(itemId, {
              name: productForm.name,
              type: productForm.type,
              sku: productForm.sku,
              supplier: productForm.supplier,
              is_active: productForm.is_actual,
              image: productForm.image,
            })
            navigate('/dictionaries/products')
          },
        })
        return
      }
      await createProduct({
        name: productForm.name,
        type: productForm.type,
        sku: productForm.sku,
        supplier: productForm.supplier,
        image: productForm.image,
        is_active: productForm.is_actual,
      })
      navigate('/dictionaries/products')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Ошибка сохранения')
    }
  }

  async function onDelete() {
    if (!itemId) return
    setError('')
    setConfirmDialog({
      text: 'Данные в карточках могут быть утеряны',
      onConfirm: async () => {
        if (!isProducts) {
          await deleteDictionaryItem(activeSection as BasicKind, itemId)
        } else {
          await deleteProduct(itemId)
        }
        navigate(`/dictionaries/${activeSection}`)
      },
    })
  }

  async function confirmAction() {
    if (!confirmDialog) return
    const action = confirmDialog.onConfirm
    setConfirmDialog(null)
    try {
      await action()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Ошибка выполнения действия')
    }
  }

  const isProductListMode = isProducts && !isCreateMode && !isEditMode
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(productsTotal / productLimit) || 1),
    [productsTotal, productLimit],
  )

  return (
    <main className={isProductListMode ? 'page page--center' : 'page'}>
      <section
        className={
          isProductListMode
            ? 'auth-card users-card product-dict-card'
            : 'auth-card users-card'
        }
      >
        {isProductListMode ? (
          <>
            <nav className="dict-breadcrumbs product-dict-breadcrumbs" aria-label="Навигация">
              <Link className="dict-breadcrumbs__link" to="/dashboard">
                Главная
              </Link>
              <span className="dict-breadcrumbs__sep" aria-hidden>
                {' '}
                /{' '}
              </span>
              <Link className="dict-breadcrumbs__link" to="/dictionaries">
                Справочники
              </Link>
              <span className="dict-breadcrumbs__sep" aria-hidden>
                {' '}
                /{' '}
              </span>
              <span className="dict-breadcrumbs__current">Справочник товаров</span>
            </nav>

            <div className="product-list-toolbar">
              <h1 className="auth-card__title product-dict-page-title">Справочник товаров</h1>
              <Link className="btn btn--primary product-list-create-btn" to="/dictionaries/products/new">
                Создать
              </Link>
            </div>

            <div className="table-wrap product-table-wrap">
              <table className="users-table users-table--interactive">
                <thead>
                  <tr>
                    <th>Название товара</th>
                    <th>Тип</th>
                    <th>Артикул товара</th>
                    <th>Поставщик</th>
                    <th>Фото товара</th>
                    <th>Актуален</th>
                    <th>Дата создания</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/dictionaries/products/${item.id}`)}
                    >
                      <td>{item.name}</td>
                      <td>{PRODUCT_TYPE_LABELS[item.type]}</td>
                      <td>{item.sku}</td>
                      <td>{item.supplier || '—'}</td>
                      <td>
                        {item.image_url ? (
                          <img
                            className="product-thumb"
                            src={`${API_BASE_URL}${item.image_url}`}
                            alt=""
                            width={40}
                            height={40}
                            loading="lazy"
                          />
                        ) : (
                          <span className="product-thumb product-thumb--empty" />
                        )}
                      </td>
                      <td>
                        <span
                          className="product-na"
                          title={item.is_active ? 'Актуален' : 'Не актуален'}
                        >
                          <span
                            className={
                              item.is_active
                                ? 'product-na__box product-na__box--on'
                                : 'product-na__box'
                            }
                            aria-hidden
                          />
                          <span className="product-na__label">
                            {item.is_active ? 'Да' : 'Нет'}
                          </span>
                        </span>
                      </td>
                      <td>{formatDateDdMmYyyy(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="product-pagination">
              <div className="product-pagination__nav">
                <button
                  className="btn btn--secondary product-pagination__btn"
                  type="button"
                  disabled={productPage <= 1}
                  onClick={() => setProductPage((p) => Math.max(1, p - 1))}
                >
                  Назад
                </button>
                <span className="product-pagination__info">
                  {productsTotal === 0
                    ? '0'
                    : `${(productPage - 1) * productLimit + 1}–${Math.min(
                        productPage * productLimit,
                        productsTotal,
                      )}`}{' '}
                  из {productsTotal} (стр. {productPage} / {totalPages})
                </span>
                <button
                  className="btn btn--secondary product-pagination__btn"
                  type="button"
                  disabled={productPage >= totalPages}
                  onClick={() => setProductPage((p) => Math.min(totalPages, p + 1))}
                >
                  Вперёд
                </button>
              </div>
              <label className="product-pagination__limit">
                <span className="product-pagination__limit-label">Записей на странице</span>
                <select
                  className="field-input product-pagination__select"
                  value={productLimit}
                  onChange={(event) => {
                    setProductLimit(Number(event.target.value) as 20 | 50 | 100)
                    setProductPage(1)
                  }}
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
            </div>

            {error ? <p className="error-text">{error}</p> : null}
          </>
        ) : (
          <>
        <h1 className="auth-card__title">Справочники</h1>
        <p className="auth-card__subtitle">
          {!isCreateMode && !isEditMode
            ? currentMeta.listTitle
            : isCreateMode
              ? currentMeta.createTitle
              : currentMeta.cardTitle}
        </p>

        <div className="dict-nav">
          {sections.map((sectionItem) => (
            <Link
              key={sectionItem.key}
              className={`btn btn--secondary dict-nav__item ${sectionItem.key === activeSection ? 'dict-nav__item--active' : ''}`}
              to={`/dictionaries/${sectionItem.key}`}
            >
              {sectionItem.label}
            </Link>
          ))}
        </div>

        {!isCreateMode && !isEditMode && !isProducts ? (
          <>
            <div className="dashboard-actions">
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => navigate(`/dictionaries/${activeSection}/new`)}
              >
                Создать
              </button>
            </div>
            <div className="table-wrap">
              <table className="users-table users-table--interactive">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Не актуален</th>
                    <th>Дата создания</th>
                    <th>Создал</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/dictionaries/${activeSection}/${item.id}`)}
                    >
                      <td>{item.name}</td>
                      <td>{item.is_active ? 'Да' : 'Нет'}</td>
                      <td>{new Date(item.created_at).toLocaleString('ru-RU')}</td>
                      <td>{item.creator || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : !isCreateMode && !isEditMode ? null : !isProducts ? (
          <form className="auth-form" onSubmit={onSaveDictionary}>
            <label className="field-label" htmlFor="dict-name">{currentMeta.nameLabel}</label>
            <input
              id="dict-name"
              className="field-input"
              value={dictForm.name}
              onChange={(event) => setDictForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <label className="remember">
              <input
                type="checkbox"
                checked={dictForm.is_not_actual}
                onChange={(event) =>
                  setDictForm((prev) => ({ ...prev, is_not_actual: event.target.checked }))
                }
              />
              <span className="remember__box"></span>
              <span className="remember__text">Не актуален</span>
            </label>
            <div className="dashboard-actions">
              <button className="btn btn--primary" type="submit">
                {isCreateMode ? 'Создать' : 'Сохранить'}
              </button>
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => navigate(`/dictionaries/${activeSection}`)}
              >
                {isCreateMode ? 'Отмена' : 'Назад'}
              </button>
              {isEditMode ? (
                <button
                  className="btn btn--secondary users-action-btn--danger"
                  type="button"
                  onClick={onDelete}
                >
                  Удалить
                </button>
              ) : null}
            </div>
          </form>
        ) : isEditMode ? (
          <form className="auth-form" onSubmit={onSaveProduct}>
            <label className="field-label" htmlFor="product-name">Название товара</label>
            <input
              id="product-name"
              className="field-input"
              value={productForm.name}
              onChange={(event) => setProductForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <label className="field-label" htmlFor="product-type">Тип</label>
            <select
              id="product-type"
              className="field-input"
              value={productForm.type}
              onChange={(event) =>
                setProductForm((prev) => ({
                  ...prev,
                  type: event.target.value as ProductType,
                }))
              }
            >
              <option value="clothes">{PRODUCT_TYPE_LABELS.clothes}</option>
              <option value="tech">{PRODUCT_TYPE_LABELS.tech}</option>
            </select>
            <label className="field-label" htmlFor="product-sku">Артикул товара</label>
            <input
              id="product-sku"
              className="field-input"
              value={productForm.sku}
              onChange={(event) => setProductForm((prev) => ({ ...prev, sku: event.target.value }))}
              required
            />
            <label className="field-label" htmlFor="product-supplier">Поставщик</label>
            <input
              id="product-supplier"
              className="field-input"
              value={productForm.supplier}
              onChange={(event) => setProductForm((prev) => ({ ...prev, supplier: event.target.value }))}
            />
            <label className="field-label" htmlFor="product-image">Фото товара (JPG, PNG, HEIC)</label>
            {isEditMode && productForm.image_url ? (
              <a
                className="dict-image-link"
                href={`${API_BASE_URL}${productForm.image_url}`}
                target="_blank"
                rel="noreferrer"
              >
                Открыть текущее фото
              </a>
            ) : null}
            <input
              id="product-image"
              className="field-input"
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/heic,image/heif,.heic,.heif"
              onChange={(event) =>
                setProductForm((prev) => ({ ...prev, image: event.target.files?.[0] || null }))
              }
            />
            <label className="remember">
              <input
                type="checkbox"
                checked={productForm.is_actual}
                onChange={(event) =>
                  setProductForm((prev) => ({ ...prev, is_actual: event.target.checked }))
                }
              />
              <span className="remember__box"></span>
              <span className="remember__text">Актуален</span>
            </label>
            <div className="dashboard-actions">
              <button className="btn btn--primary" type="submit">
                {isCreateMode ? 'Создать' : 'Сохранить'}
              </button>
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => navigate(`/dictionaries/${activeSection}`)}
              >
                {isCreateMode ? 'Отмена' : 'Назад'}
              </button>
              {isEditMode ? (
                <button
                  className="btn btn--secondary users-action-btn--danger"
                  type="button"
                  onClick={onDelete}
                >
                  Удалить
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        {meta ? (
          <div className="table-wrap">
            <table className="users-table">
              <tbody>
                <tr>
                  <th>Дата создания</th>
                  <td>{new Date(meta.created_at).toLocaleString('ru-RU')}</td>
                </tr>
                <tr>
                  <th>Создал</th>
                  <td>{meta.creator || '-'}</td>
                </tr>
                <tr>
                  <th>Дата изменения</th>
                  <td>{meta.updated_at ? new Date(meta.updated_at).toLocaleString('ru-RU') : '-'}</td>
                </tr>
                <tr>
                  <th>Редактировал</th>
                  <td>{meta.editor || '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
          </>
        )}
      </section>

      {confirmDialog ? (
        <div className="modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true">
            <p className="confirm-modal__text">{confirmDialog.text}</p>
            <div className="confirm-modal__actions">
              <button className="btn btn--primary" type="button" onClick={confirmAction}>
                Да
              </button>
              <button className="btn btn--secondary" type="button" onClick={() => setConfirmDialog(null)}>
                Нет
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
