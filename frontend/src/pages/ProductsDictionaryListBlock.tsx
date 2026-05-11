import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ImageFullscreenLightbox } from '../components/ImageFullscreenLightbox'
import { ListPageLayout } from '../components/ListPageLayout'
import { ListPagination } from '../components/ListPagination'
import { Table, type TableColumn } from '../components/Table'
import { useQueryState } from '../hooks/useQueryState'
import {
  buildActualityFilterSelectOptions,
  fetchAllDictionaryItemsForFilter,
  fetchRecordActualityFilterItems,
  getClientPortalProductCatalog,
  getClientPortalProductTypes,
  getClientPortalRecordActualityFilterItems,
  getProducts,
  resolvePublicUploadSrc,
  type DictionaryItem,
  type ProductItem,
  type RecordActualityFilterItem,
} from '../api'

const PRODUCT_FILTER_KEYS_ADMIN = ['sku', 'name', 'type_id', 'client_id', 'actuality_id'] as const
const PRODUCT_FILTER_KEYS_CLIENT_CABINET = ['sku', 'name', 'type_id', 'actuality_id'] as const

export type ProductsDictionaryListVariant = 'dictionaries' | 'client_cabinet'

export type ProductsDictionaryListBlockProps = {
  variant?: ProductsDictionaryListVariant
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

function dictionarySelectOptions(items: DictionaryItem[], placeholder: string) {
  return [
    { value: '', label: placeholder },
    ...items.map((i) => ({
      value: i.id,
      label: i.is_active ? i.name : `${i.name} (не актуален)`,
    })),
  ]
}

function portalProductTypesAsDictionary(
  pts: { id: string; name: string; requires_color: boolean; requires_size: boolean }[],
): DictionaryItem[] {
  const empty = ''
  return pts.map((p) => ({
    id: p.id,
    name: p.name,
    is_active: true,
    created_at: empty,
    created_by: null,
    updated_at: null,
    updated_by: null,
  }))
}

export function ProductsDictionaryListBlock({
  variant = 'dictionaries',
}: ProductsDictionaryListBlockProps = {}) {
  const navigate = useNavigate()
  const isClientCabinet = variant === 'client_cabinet'
  const filterKeys = isClientCabinet ? PRODUCT_FILTER_KEYS_CLIENT_CABINET : PRODUCT_FILTER_KEYS_ADMIN
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys })

  const [productTypes, setProductTypes] = useState<DictionaryItem[]>([])
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [actualityItems, setActualityItems] = useState<RecordActualityFilterItem[]>([])

  const [products, setProducts] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (isClientCabinet) {
      Promise.all([
        getClientPortalProductTypes().then(portalProductTypesAsDictionary),
        getClientPortalRecordActualityFilterItems(),
      ])
        .then(([pt, act]) => {
          if (!cancelled) {
            setProductTypes(pt)
            setClients([])
            setActualityItems(act)
          }
        })
        .catch(() => {
          /* фильтры подгрузятся при следующем открытии */
        })
    } else {
      Promise.all([
        fetchAllDictionaryItemsForFilter('/product-types', 'name'),
        fetchAllDictionaryItemsForFilter('/clients', 'search'),
        fetchRecordActualityFilterItems(),
      ])
        .then(([pt, cl, act]) => {
          if (!cancelled) {
            setProductTypes(pt)
            setClients(cl)
            setActualityItems(act)
          }
        })
        .catch(() => {
          /* список фильтров подгрузится при следующем открытии; таблица покажет ошибку API */
        })
    }
    return () => {
      cancelled = true
    }
  }, [isClientCabinet])

  const productFilterFields: FilterFieldConfig[] = useMemo(() => {
    const base: FilterFieldConfig[] = [
      { name: 'sku', type: 'text', placeholder: 'Штрих-код' },
      { name: 'name', type: 'text', placeholder: 'Название' },
      {
        name: 'type_id',
        type: 'dictionary_autocomplete',
        options: dictionarySelectOptions(productTypes, 'Тип товара'),
      },
    ]
    if (!isClientCabinet) {
      base.push({
        name: 'client_id',
        type: 'dictionary_autocomplete',
        options: dictionarySelectOptions(clients, 'Клиент'),
      })
    }
    base.push({
      name: 'actuality_id',
      type: 'dictionary_autocomplete',
      options: buildActualityFilterSelectOptions(actualityItems, 'Актуальность'),
    })
    return base
  }, [productTypes, clients, actualityItems, isClientCabinet])

  const productColumns = useMemo<TableColumn<ProductItem>[]>(
    () => [
      {
        key: 'sku_base',
        title: 'Штрих-код',
        sortable: true,
        render: (_, row) => (row.sku_base?.trim() ? row.sku_base : '—'),
      },
      { key: 'name', title: 'Название', sortable: true },
      {
        key: 'preview',
        title: 'Превью',
        sortable: false,
        render: (_, row) => {
          const raw = row.image_urls?.[0]
          if (!raw?.trim()) {
            return (
              <span
                className="product-thumb product-thumb--empty product-list-preview-placeholder"
                aria-hidden
              />
            )
          }
          const src = resolvePublicUploadSrc(raw)
          return (
            <button
              type="button"
              className="product-list-preview-btn"
              onClick={(e) => {
                e.stopPropagation()
                setLightboxSrc(src)
              }}
              aria-label="Открыть превью фото"
            >
              <img src={src} alt="" className="product-thumb" width={45} height={45} />
            </button>
          )
        },
      },
      {
        key: 'type',
        title: 'Тип товара',
        sortable: true,
        render: (_, row) => (row.type_name == null || row.type_name === '' ? '—' : row.type_name),
      },
      {
        key: 'client',
        title: 'Клиент',
        sortable: true,
        render: (_, row) =>
          row.client_name == null || row.client_name === '' ? '—' : row.client_name,
      },
      {
        key: 'variant_count',
        title: 'Кол-во вариантов',
        sortable: false,
        render: (v) => String(v ?? 0),
      },
      {
        key: 'is_active',
        title: 'Актуален',
        sortable: true,
        render: (_, row) => (
          <span className="product-na" title={row.is_active ? 'Актуален' : 'Не актуален'}>
            <span
              className={row.is_active ? 'product-na__box product-na__box--on' : 'product-na__box'}
              aria-hidden
            />
            <span className="product-na__label">{row.is_active ? 'Да' : 'Нет'}</span>
          </span>
        ),
      },
      {
        key: 'created_at',
        title: 'Дата создания',
        sortable: true,
        render: (v) => formatDateDdMmYyyy(String(v)),
      },
    ],
    [setLightboxSrc],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const listParams = {
      page: apiParams.page,
      limit: apiParams.limit,
      name: apiParams.name,
      sku: apiParams.sku,
      type_id: apiParams.type_id,
      client_id: isClientCabinet ? undefined : apiParams.client_id,
      actuality_id: apiParams.actuality_id,
      sort: apiParams.sort,
    }
    const req = isClientCabinet ? getClientPortalProductCatalog(listParams) : getProducts(listParams)
    req
      .then((res) => {
        if (cancelled) return
        setProducts(res.items)
        setTotal(res.total)
        const lastPage = Math.max(1, Math.ceil(res.total / query.limit) || 1)
        if (res.total > 0 && query.page > lastPage) {
          setPage(lastPage)
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apiParams, query.limit, query.page, setPage, reloadKey, isClientCabinet])

  const rowNavigate = (row: ProductItem) => {
    if (isClientCabinet) {
      navigate(`/cabinet/products/${row.id}`)
    } else {
      navigate(`/dictionaries/products/${row.id}`)
    }
  }

  return (
    <>
      <ListPageLayout
        wrapWithPageContainer={false}
        breadcrumbs={<Breadcrumbs />}
        filters={
          <FiltersPanel
            disabled={loading}
            fields={productFilterFields}
            values={{
              sku: query.filters.sku,
              name: query.filters.name,
              type_id: query.filters.type_id,
              client_id: query.filters.client_id,
              actuality_id: query.filters.actuality_id,
            }}
            onTextFilterDebounced={(name, value) => {
              const v = value || undefined
              if (name === 'name') setFilters({ name: v })
              if (name === 'sku') setFilters({ sku: v })
            }}
            onSelectChange={(name, value) => {
              if (name === 'actuality_id') {
                setFilters({
                  actuality_id: value === null || value === undefined ? undefined : String(value),
                })
              } else if (name === 'type_id') {
                setFilters({
                  type_id: value === null || value === undefined ? undefined : String(value),
                })
              } else if (name === 'client_id') {
                setFilters({
                  client_id: value === null || value === undefined ? undefined : String(value),
                })
              }
            }}
            actions={
              <CollectionActions
                createHref={isClientCabinet ? undefined : '/dictionaries/products/new'}
                onResetFilters={resetFilters}
                disabled={loading}
              />
            }
          />
        }
        table={
          <Table<ProductItem>
            columns={productColumns}
            data={products}
            loading={loading}
            onRowClick={rowNavigate}
            sort={query.sort}
            onSortClick={cycleSortField}
            wrapClassName="product-table-wrap"
          />
        }
        pagination={
          <ListPagination
            page={query.page}
            limit={query.limit}
            total={total}
            onPageChange={setPage}
            onLimitChange={setLimit}
            disabled={loading}
          />
        }
        error={error || null}
        onRetry={() => {
          setError('')
          setReloadKey((k) => k + 1)
        }}
      />
      <ImageFullscreenLightbox
        open={lightboxSrc !== null}
        src={lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />
    </>
  )
}
