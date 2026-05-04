import { useEffect, useMemo, useState } from 'react'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ListPageLayout } from '../components/ListPageLayout'
import { ListPagination } from '../components/ListPagination'
import { Table, type TableColumn } from '../components/Table'
import { useQueryState } from '../hooks/useQueryState'
import {
  type InventoryBalanceItem,
  type InventoryProductLookup,
  type InventoryProductTypeLookup,
  getClientPortalBalances,
  getClientPortalProducts,
  getClientPortalProductTypes,
} from '../api'

const FILTER_KEYS = ['search', 'type_id', 'product_id'] as const

function dictOptions(items: { id: string; name: string }[], placeholder: string) {
  return [{ value: '', label: placeholder }, ...items.map((i) => ({ value: i.id, label: i.name }))]
}

export function ClientCabinetBalancesPage() {
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys: FILTER_KEYS })

  const [items, setItems] = useState<InventoryBalanceItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [types, setTypes] = useState<InventoryProductTypeLookup[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([getClientPortalProductTypes(), getClientPortalProducts()])
      .then(([ts, pr]) => {
        if (cancelled) return
        setTypes(ts)
        setProducts(pr)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filterFields: FilterFieldConfig[] = useMemo(
    () => [
      { name: 'search', type: 'text', placeholder: 'Поиск по названию товара' },
      { name: 'type_id', type: 'dictionary_autocomplete', options: dictOptions(types, 'Тип товара') },
      { name: 'product_id', type: 'dictionary_autocomplete', options: dictOptions(products, 'Товар') },
    ],
    [products, types],
  )

  const columns: TableColumn<InventoryBalanceItem>[] = useMemo(
    () => [
      { key: 'product_name', title: 'Товар', sortable: true },
      {
        key: 'product_type_name',
        title: 'Тип',
        sortable: true,
        render: (v) => (v as string) || '—',
      },
      { key: 'color_name', title: 'Цвет', sortable: true, render: (v) => (v as string) || '—' },
      { key: 'size_name', title: 'Размер', sortable: true, render: (v) => (v as string) || '—' },
      {
        key: 'quantity',
        title: 'Количество',
        sortable: true,
        render: (v) => {
          const n = Number(v) || 0
          const cls = n <= 0 ? 'qty-zero' : 'qty-positive'
          return <span className={cls}>{n}</span>
        },
      },
    ],
    [],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getClientPortalBalances({
      page: apiParams.page,
      limit: apiParams.limit,
      product_id: apiParams.product_id,
      type_id: apiParams.type_id,
      search: apiParams.search,
      only_positive: true,
      sort: apiParams.sort,
    })
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setTotal(res.total)
        const lastPage = Math.max(1, Math.ceil(res.total / query.limit) || 1)
        if (res.total > 0 && query.page > lastPage) setPage(lastPage)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apiParams, query.limit, query.page, setPage, reloadKey])

  return (
    <>
      <h1 className="cabinet-page-title">Остатки</h1>
      <ListPageLayout
        wrapWithPageContainer={false}
        breadcrumbs={null}
        filters={
          <FiltersPanel
            disabled={loading}
            fields={filterFields}
            values={{
              search: query.filters.search,
              type_id: query.filters.type_id,
              product_id: query.filters.product_id,
            }}
            onTextFilterDebounced={(name, value) => {
              if (name === 'search') setFilters({ search: value || undefined })
            }}
            onSelectChange={(name, value) => {
              if (name === 'type_id' || name === 'product_id') {
                setFilters({ [name]: value ?? undefined })
              }
            }}
            actions={<CollectionActions onResetFilters={resetFilters} disabled={loading} />}
          />
        }
        table={
          <Table<InventoryBalanceItem>
            columns={columns}
            data={items}
            loading={loading}
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
    </>
  )
}
