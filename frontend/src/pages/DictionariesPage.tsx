import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { createDictionaryItem, deleteDictionaryItem, getDictionary, getDictionaryItem, updateDictionaryItem } from '../api'
import type { DictionaryItem } from '../api'
import { Table, type TableColumn } from '../components/Table'
import { ProductsDictionaryListBlock } from './ProductsDictionaryListBlock'

function authorCreated(item: DictionaryItem): string | null {
  return item.creator
}

function authorUpdated(item: DictionaryItem): string | null {
  return item.editor
}

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
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(false)

  const [dictForm, setDictForm] = useState({ name: '', is_not_actual: false })

  const [meta, setMeta] = useState<DictionaryItem | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    text: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const currentMeta = useMemo(() => dictionaryMeta[activeSection], [activeSection])

  const dictionaryListColumns: TableColumn<DictionaryItem>[] = useMemo(
    () => [
      { key: 'name', title: 'Название' },
      { key: 'is_active', title: 'Не актуален', render: (v) => ((v as boolean) ? 'Да' : 'Нет') },
      {
        key: 'created_at',
        title: 'Дата создания',
        render: (_, row) => new Date(row.created_at).toLocaleString('ru-RU'),
      },
      { key: 'creator', title: 'Создал', render: (v) => (v ? String(v) : '-') },
    ],
    [],
  )

  useEffect(() => {
    let cancelled = false
    setError('')
    setMeta(null)
    if (!isCreateMode && !isEditMode) {
      if (isProducts) {
        return () => {
          cancelled = true
        }
      }
      if (activeSection === 'colors' || activeSection === 'sizes') {
        setListLoading(true)
        setItems([])
        getDictionary(activeSection)
          .then((rows) => {
            if (!cancelled) setItems(rows)
          })
          .catch((requestError) => {
            if (!cancelled) {
              setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки')
            }
          })
          .finally(() => {
            if (!cancelled) setListLoading(false)
          })
      }
      return () => {
        cancelled = true
      }
    }

    if (isCreateMode) {
      if (!isProducts) {
        setDictForm({ name: '', is_not_actual: false })
      }
      return () => {
        cancelled = true
      }
    }

    if (!itemId) {
      return () => {
        cancelled = true
      }
    }
    if (isProducts) {
      return () => {
        cancelled = true
      }
    }
    getDictionaryItem(activeSection as BasicKind, itemId)
      .then((item) => {
        if (!cancelled) {
          setDictForm({ name: item.name, is_not_actual: item.is_active })
          setMeta(item)
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки')
        }
      })

    return () => {
      cancelled = true
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

  async function onDelete() {
    if (!itemId) return
    if (isProducts) return
    setError('')
    setConfirmDialog({
      text: 'Данные в карточках могут быть утеряны',
      onConfirm: async () => {
        await deleteDictionaryItem(activeSection as BasicKind, itemId)
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
          <ProductsDictionaryListBlock />
        ) : (
          <>
        <Breadcrumbs />
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
            <div className="lk-actions">
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => navigate(`/dictionaries/${activeSection}/new`)}
              >
                Создать
              </button>
            </div>
            <Table<DictionaryItem>
              columns={dictionaryListColumns}
              data={items}
              loading={listLoading}
              onRowClick={(item) => navigate(`/dictionaries/${activeSection}/${item.id}`)}
            />
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
            <div className="lk-actions">
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
                  <td>{authorCreated(meta) || '-'}</td>
                </tr>
                <tr>
                  <th>Дата изменения</th>
                  <td>{meta.updated_at ? new Date(meta.updated_at).toLocaleString('ru-RU') : '-'}</td>
                </tr>
                <tr>
                  <th>Редактировал</th>
                  <td>{authorUpdated(meta) || '-'}</td>
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
