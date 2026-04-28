import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
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
import type { DictionaryItem, ProductItem } from '../api'

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

export function DictionariesPage() {
  const navigate = useNavigate()
  const { section = 'clients', itemId } = useParams<{ section: DictionaryKind; itemId?: string }>()
  const activeSection = section as DictionaryKind
  const isProducts = activeSection === 'products'
  const isCreateMode = itemId === 'new'
  const isEditMode = Boolean(itemId && itemId !== 'new')

  const [items, setItems] = useState<DictionaryItem[]>([])
  const [products, setProducts] = useState<ProductItem[]>([])
  const [error, setError] = useState('')

  const [dictForm, setDictForm] = useState({ name: '', is_not_actual: false })
  const [productForm, setProductForm] = useState({
    name: '',
    type: 'одежда' as 'одежда' | 'техника',
    sku: '',
    supplier: '',
    is_not_actual: false,
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
        getProducts()
          .then(setProducts)
          .catch((requestError) =>
            setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки'),
          )
      }
      return
    }

    if (isCreateMode) {
      setDictForm({ name: '', is_not_actual: false })
      setProductForm({
        name: '',
        type: 'одежда',
        sku: '',
        supplier: '',
        is_not_actual: false,
        image: null,
        image_url: null,
      })
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
            is_not_actual: item.is_active,
            image: null,
            image_url: item.image_url,
          })
          setMeta(item)
        })
        .catch((requestError) =>
          setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки'),
        )
    }
  }, [activeSection, isProducts, isCreateMode, isEditMode, itemId])

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
              is_active: productForm.is_not_actual,
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
        is_active: productForm.is_not_actual,
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

  return (
    <main className="page">
      <section className="auth-card users-card">
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

        {!isCreateMode && !isEditMode ? (
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
              <table className="users-table">
                <thead>
                  <tr>
                    <th>{isProducts ? 'Название товара' : 'Название'}</th>
                    {isProducts ? <th>Тип</th> : null}
                    {isProducts ? <th>Артикул</th> : null}
                    {isProducts ? <th>Поставщик</th> : null}
                    {isProducts ? <th>Фото</th> : null}
                    <th>Не актуален</th>
                    <th>Дата создания</th>
                    <th>Создал</th>
                  </tr>
                </thead>
                <tbody>
                  {!isProducts
                    ? items.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => navigate(`/dictionaries/${activeSection}/${item.id}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>{item.name}</td>
                          <td>{item.is_active ? 'Да' : 'Нет'}</td>
                          <td>{new Date(item.created_at).toLocaleString('ru-RU')}</td>
                          <td>{item.creator || '-'}</td>
                        </tr>
                      ))
                    : products.map((item) => (
                        <tr
                          key={item.id}
                          onClick={() => navigate(`/dictionaries/products/${item.id}`)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>{item.name}</td>
                          <td>{item.type}</td>
                          <td>{item.sku}</td>
                          <td>{item.supplier || '-'}</td>
                          <td>{item.image_url ? 'Есть' : 'Нет'}</td>
                          <td>{item.is_active ? 'Да' : 'Нет'}</td>
                          <td>{new Date(item.created_at).toLocaleString('ru-RU')}</td>
                          <td>{item.creator || '-'}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </>
        ) : !isProducts ? (
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
        ) : (
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
                  type: event.target.value as 'одежда' | 'техника',
                }))
              }
            >
              <option value="одежда">Одежда</option>
              <option value="техника">Техника</option>
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
            <label className="field-label" htmlFor="product-image">Фото товара (jpg/png)</label>
            {isEditMode && productForm.image_url ? (
              <a
                className="dict-image-link"
                href={`http://127.0.0.1:8000${productForm.image_url}`}
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
              accept=".png,.jpg,.jpeg"
              onChange={(event) =>
                setProductForm((prev) => ({ ...prev, image: event.target.files?.[0] || null }))
              }
            />
            <label className="remember">
              <input
                type="checkbox"
                checked={productForm.is_not_actual}
                onChange={(event) =>
                  setProductForm((prev) => ({ ...prev, is_not_actual: event.target.checked }))
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
        )}

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
