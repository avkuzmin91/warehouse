import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ListPagination } from '../components/ListPagination'
import { Table, type TableColumn } from '../components/Table'
import { useQueryState } from '../hooks/useQueryState'
import { API_BASE_URL, getProducts, PRODUCT_TYPE_LABELS } from '../api'
import type { ProductItem } from '../api'

const PRODUCT_FILTER_KEYS = ['search', 'type', 'sku', 'supplier', 'is_active'] as const

const productFilterFields: FilterFieldConfig[] = [
  { name: 'search', type: 'text', placeholder: 'Поиск по названию' },
  {
    name: 'type',
    type: 'select',
    options: [
      { value: '', label: 'Тип' },
      { value: 'clothes', label: 'Одежда' },
      { value: 'tech', label: 'Техника' },
    ],
  },
  { name: 'sku', type: 'text', placeholder: 'Артикул' },
  { name: 'supplier', type: 'text', placeholder: 'Поставщик' },
  {
    name: 'is_active',
    type: 'select',
    options: [
      { value: '', label: 'Актуален' },
      { value: 'true', label: 'Да' },
      { value: 'false', label: 'Нет' },
    ],
  },
]

function formatDateDdMmYyyy(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const productColumns: TableColumn<ProductItem>[] = [
  { key: 'name', title: 'Название товара', sortable: true },
  {
    key: 'type',
    title: 'Тип',
    sortable: true,
    render: (_, row) => PRODUCT_TYPE_LABELS[row.type],
  },
  { key: 'sku', title: 'Артикул товара', sortable: true },
  {
    key: 'supplier',
    title: 'Поставщик',
    sortable: true,
    render: (v) => (v == null || v === '' ? '—' : String(v)),
  },
  {
    key: 'image_url',
    title: 'Фото товара',
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

  const [products, setProducts] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getProducts(apiParams)
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
  }, [apiParams, query.limit, query.page, setPage])

  return (
    <>
      <Breadcrumbs />

      <FiltersPanel
        fields={productFilterFields}
        values={{
          search: query.filters.search,
          sku: query.filters.sku,
          supplier: query.filters.supplier,
          type: query.filters.type,
          is_active: query.filters.is_active,
        }}
        onTextFilterDebounced={(name, value) => {
          const v = value || undefined
          if (name === 'search') setFilters({ search: v })
          else if (name === 'sku') setFilters({ sku: v })
          else setFilters({ supplier: v })
        }}
        onSelectChange={(name, value) => {
          if (name === 'type') {
            setFilters({ type: value === null ? undefined : String(value) })
          } else {
            setFilters({
              is_active: value === null || value === undefined ? undefined : Boolean(value),
            })
          }
        }}
        actions={
          <CollectionActions
            createHref="/dictionaries/products/new"
            onResetFilters={resetFilters}
          />
        }
      />

      <Table<ProductItem>
        columns={productColumns}
        data={products}
        loading={loading}
        onRowClick={(row) => navigate(`/dictionaries/products/${row.id}`)}
        sort={query.sort}
        onSortClick={cycleSortField}
        wrapClassName="product-table-wrap"
      />

      <ListPagination
        page={query.page}
        limit={query.limit}
        total={total}
        onPageChange={setPage}
        onLimitChange={setLimit}
      />

      {error ? <p className="error-text">{error}</p> : null}
    </>
  )
}
