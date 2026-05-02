import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ListPageLayout } from '../components/ListPageLayout'
import { ListPagination } from '../components/ListPagination'
import { Table, type TableColumn } from '../components/Table'
import { useQueryState } from '../hooks/useQueryState'
import {
  API_BASE_URL,
  buildActualityFilterSelectOptions,
  fetchAllDictionaryItemsForFilter,
  fetchRecordActualityFilterItems,
  getProducts,
  type DictionaryItem,
  type RecordActualityFilterItem,
} from '../api'
import type { ProductItem } from '../api'

const PRODUCT_FILTER_KEYS = [
  'name',
  'type_id',
  'sku',
  'client_id',
  'supplier_id',
  'actuality_id',
  'date_from',
  'date_to',
] as const

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

const productColumns: TableColumn<ProductItem>[] = [
  { key: 'name', title: 'Название', sortable: true },
  {
    key: 'type',
    title: 'Тип товара',
    sortable: true,
    render: (_, row) => (row.type_name == null || row.type_name === '' ? '—' : row.type_name),
  },
  { key: 'sku', title: 'Артикул', sortable: true },
  {
    key: 'client',
    title: 'Клиент',
    sortable: true,
    render: (_, row) =>
      row.client_name == null || row.client_name === '' ? '—' : row.client_name,
  },
  {
    key: 'supplier',
    title: 'Поставщик',
    sortable: true,
    render: (_, row) =>
      row.supplier_name == null || row.supplier_name === '' ? '—' : row.supplier_name,
  },
  {
    key: 'image_url',
    title: 'Фото',
    render: (_, row) =>
      row.image_url ? (
        <img
          className="product-thumb"
          src={`${API_BASE_URL}${row.image_url}`}
          alt=""
          width={40}
          height={40}
          loading="lazy"
        />
      ) : (
        <span className="product-thumb product-thumb--empty" />
      ),
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
]

export function ProductsDictionaryListBlock() {
  const navigate = useNavigate()
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys: PRODUCT_FILTER_KEYS })

  const [productTypes, setProductTypes] = useState<DictionaryItem[]>([])
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [suppliers, setSuppliers] = useState<DictionaryItem[]>([])
  const [actualityItems, setActualityItems] = useState<RecordActualityFilterItem[]>([])

  const [products, setProducts] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchAllDictionaryItemsForFilter('/product-types', 'name'),
      fetchAllDictionaryItemsForFilter('/clients', 'search'),
      fetchAllDictionaryItemsForFilter('/suppliers', 'name'),
      fetchRecordActualityFilterItems(),
    ])
      .then(([pt, cl, sup, act]) => {
        if (!cancelled) {
          setProductTypes(pt)
          setClients(cl)
          setSuppliers(sup)
          setActualityItems(act)
        }
      })
      .catch(() => {
        /* список фильтров подгрузится при следующем открытии; таблица покажет ошибку API */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const productFilterFields: FilterFieldConfig[] = useMemo(
    () => [
      { name: 'name', type: 'text', placeholder: 'Название' },
      {
        name: 'type_id',
        type: 'dictionary_autocomplete',
        options: dictionarySelectOptions(productTypes, 'Тип товара'),
      },
      { name: 'sku', type: 'text', placeholder: 'Артикул' },
      {
        name: 'client_id',
        type: 'dictionary_autocomplete',
        options: dictionarySelectOptions(clients, 'Клиент'),
      },
      {
        name: 'supplier_id',
        type: 'dictionary_autocomplete',
        options: dictionarySelectOptions(suppliers, 'Поставщик'),
      },
      {
        name: 'actuality_id',
        type: 'dictionary_autocomplete',
        options: buildActualityFilterSelectOptions(actualityItems, 'Актуальность'),
      },
      { type: 'date_range', placeholder: 'Дата создания' },
    ],
    [productTypes, clients, suppliers, actualityItems],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getProducts({
      page: apiParams.page,
      limit: apiParams.limit,
      name: apiParams.name,
      sku: apiParams.sku,
      type_id: apiParams.type_id,
      client_id: apiParams.client_id,
      supplier_id: apiParams.supplier_id,
      actuality_id: apiParams.actuality_id,
      date_from: apiParams.date_from,
      date_to: apiParams.date_to,
      sort: apiParams.sort,
    })
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
  }, [apiParams, query.limit, query.page, setPage, reloadKey])

  return (
    <ListPageLayout
      wrapWithPageContainer={false}
      breadcrumbs={<Breadcrumbs />}
      filters={
        <FiltersPanel
          disabled={loading}
          fields={productFilterFields}
          values={{
            name: query.filters.name,
            sku: query.filters.sku,
            type_id: query.filters.type_id,
            client_id: query.filters.client_id,
            supplier_id: query.filters.supplier_id,
            actuality_id: query.filters.actuality_id,
            date_from: query.filters.date_from,
            date_to: query.filters.date_to,
          }}
          onTextFilterDebounced={(name, value) => {
            const v = value || undefined
            if (name === 'name') setFilters({ name: v })
            else if (name === 'sku') setFilters({ sku: v })
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
            } else if (name === 'supplier_id') {
              setFilters({
                supplier_id: value === null || value === undefined ? undefined : String(value),
              })
            }
          }}
          onDateRangeChange={(next) =>
            setFilters({ date_from: next.date_from, date_to: next.date_to })
          }
          actions={
            <CollectionActions
              createHref="/dictionaries/products/new"
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
          onRowClick={(row) => navigate(`/dictionaries/products/${row.id}`)}
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
  )
}
