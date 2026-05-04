import { useEffect, useMemo, useState } from 'react'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ListPageLayout } from '../components/ListPageLayout'
import { ListPagination } from '../components/ListPagination'
import { Table, type TableColumn } from '../components/Table'
import { useQueryState } from '../hooks/useQueryState'
import {
  type DictionaryItem,
  type InventoryBalanceItem,
  type InventoryProductLookup,
  type InventoryProductTypeLookup,
  getInventoryBalances,
  getInventoryClients,
  getInventoryColors,
  getInventoryProductTypes,
  getInventoryProducts,
  getInventorySizes,
  getInventorySuppliers,
} from '../api'

const FILTER_KEYS = [
  'client_id',
  'product_id',
  'type_id',
  'supplier_id',
  'color_id',
  'size_id',
] as const

function dictOptions(items: { id: string; name: string }[], placeholder: string) {
  return [{ value: '', label: placeholder }, ...items.map((i) => ({ value: i.id, label: i.name }))]
}

export function InventoryBalancesPage() {
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys: FILTER_KEYS })

  const [items, setItems] = useState<InventoryBalanceItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [products, setProducts] = useState<InventoryProductLookup[]>([])
  const [types, setTypes] = useState<InventoryProductTypeLookup[]>([])
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [suppliers, setSuppliers] = useState<DictionaryItem[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getInventoryClients(),
      getInventoryProductTypes(),
      getInventoryColors(),
      getInventorySizes(),
      getInventorySuppliers(),
    ])
      .then(([cs, ts, cls, szs, sps]) => {
        if (cancelled) return
        setClients(cs)
        setTypes(ts)
        setColors(cls)
        setSizes(szs)
        setSuppliers(sps)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getInventoryProducts(query.filters.client_id ?? null)
      .then((rows) => {
        if (!cancelled) setProducts(rows)
      })
      .catch(() => {
        if (!cancelled) setProducts([])
      })
    return () => {
      cancelled = true
    }
  }, [query.filters.client_id])

  const filterFields: FilterFieldConfig[] = useMemo(
    () => [
      { name: 'client_id', type: 'dictionary_autocomplete', options: dictOptions(clients, 'Клиент') },
      { name: 'product_id', type: 'dictionary_autocomplete', options: dictOptions(products, 'Товар') },
      { name: 'type_id', type: 'dictionary_autocomplete', options: dictOptions(types, 'Тип товара') },
      { name: 'supplier_id', type: 'dictionary_autocomplete', options: dictOptions(suppliers, 'Поставщик') },
      { name: 'color_id', type: 'dictionary_autocomplete', options: dictOptions(colors, 'Цвет') },
      { name: 'size_id', type: 'dictionary_autocomplete', options: dictOptions(sizes, 'Размер') },
    ],
    [clients, products, types, suppliers, colors, sizes],
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
      { key: 'client_name', title: 'Клиент', sortable: true, render: (v) => (v as string) || '—' },
      {
        key: 'supplier_name',
        title: 'Поставщик',
        sortable: true,
        render: (v) => (v as string) || '—',
      },
      { key: 'color_name', title: 'Цвет', sortable: true, render: (v) => (v as string) || '—' },
      { key: 'size_name', title: 'Размер', sortable: true, render: (v) => (v as string) || '—' },
      {
        key: 'quantity',
        title: 'Остаток',
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
    getInventoryBalances({
      page: apiParams.page,
      limit: apiParams.limit,
      client_id: apiParams.client_id,
      product_id: apiParams.product_id,
      type_id: apiParams.type_id,
      supplier_id: apiParams.supplier_id,
      color_id: apiParams.color_id,
      size_id: apiParams.size_id,
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
    <ListPageLayout
      wrapWithPageContainer
      pageContainerProps={{ cardClassName: 'users-card product-dict-card' }}
      breadcrumbs={<Breadcrumbs />}
      filters={
        <FiltersPanel
          disabled={loading}
          fields={filterFields}
          values={{
            client_id: query.filters.client_id,
            product_id: query.filters.product_id,
            type_id: query.filters.type_id,
            supplier_id: query.filters.supplier_id,
            color_id: query.filters.color_id,
            size_id: query.filters.size_id,
          }}
          onTextFilterDebounced={() => {}}
          onSelectChange={(name, value) => {
            if (name === 'client_id') {
              setFilters({ client_id: value ?? undefined, product_id: undefined })
            } else if (
              name === 'product_id' ||
              name === 'type_id' ||
              name === 'supplier_id' ||
              name === 'color_id' ||
              name === 'size_id'
            ) {
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
  )
}
