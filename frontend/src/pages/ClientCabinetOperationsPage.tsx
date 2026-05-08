import { useEffect, useMemo, useState } from 'react'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ListPageLayout } from '../components/ListPageLayout'
import { ListPagination } from '../components/ListPagination'
import { Table, type TableColumn } from '../components/Table'
import { useQueryState } from '../hooks/useQueryState'
import { getInventoryOpListRowPresentation } from '../utils/inventoryOperationRowVisual'
import {
  type InventoryOperationItem,
  type InventoryOpType,
  type InventoryProductLookup,
  getClientPortalOperations,
  getClientPortalProducts,
} from '../api'

const FILTER_KEYS = ['search', 'product_id', 'date_from', 'date_to'] as const

function dictOptions(items: { id: string; name: string }[], placeholder: string) {
  return [{ value: '', label: placeholder }, ...items.map((i) => ({ value: i.id, label: i.name }))]
}

function formatDateDdMmYyyy(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function ClientCabinetOperationsPage({ opType }: { opType: InventoryOpType }) {
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys: FILTER_KEYS })

  const [items, setItems] = useState<InventoryOperationItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [products, setProducts] = useState<InventoryProductLookup[]>([])

  const title = opType === 'out' ? 'Отгрузки' : 'Поступления'

  useEffect(() => {
    let cancelled = false
    getClientPortalProducts()
      .then((rows) => {
        if (!cancelled) setProducts(rows)
      })
      .catch(() => {
        if (!cancelled) setProducts([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filterFields: FilterFieldConfig[] = useMemo(
    () => [
      { name: 'search', type: 'text', placeholder: 'Поиск по названию товара' },
      { name: 'product_id', type: 'dictionary_autocomplete', options: dictOptions(products, 'Товар') },
      { type: 'date_range', placeholder: 'Период' },
    ],
    [products],
  )

  const columns: TableColumn<InventoryOperationItem>[] = useMemo(
    () => [
      {
        key: 'created_at',
        title: 'Дата',
        sortable: true,
        render: (v) => formatDateDdMmYyyy(String(v)),
      },
      { key: 'product_name', title: 'Товар', sortable: true },
      {
        key: 'product_type_name',
        title: 'Тип',
        sortable: true,
        render: (v) => (v as string) || '—',
      },
      { key: 'color_name', title: 'Цвет', sortable: true, render: (v) => (v as string) || '—' },
      { key: 'size_name', title: 'Размер', sortable: true, render: (v) => (v as string) || '—' },
      { key: 'quantity', title: 'Количество', sortable: true },
    ],
    [],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getClientPortalOperations({
      page: apiParams.page,
      limit: apiParams.limit,
      op_type: opType,
      product_id: apiParams.product_id,
      date_from: apiParams.date_from,
      date_to: apiParams.date_to,
      search: apiParams.search,
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
  }, [apiParams, opType, query.limit, query.page, setPage, reloadKey])

  return (
    <>
      <h1 className="cabinet-page-title">{title}</h1>
      <ListPageLayout
        wrapWithPageContainer={false}
        breadcrumbs={null}
        filters={
          <FiltersPanel
            disabled={loading}
            fields={filterFields}
            values={{
              search: query.filters.search,
              product_id: query.filters.product_id,
              date_from: query.filters.date_from,
              date_to: query.filters.date_to,
            }}
            onTextFilterDebounced={(name, value) => {
              if (name === 'search') setFilters({ search: value || undefined })
            }}
            onSelectChange={(name, value) => {
              if (name === 'product_id') {
                setFilters({ product_id: value ?? undefined })
              }
            }}
            onDateRangeChange={(next) =>
              setFilters({ date_from: next.date_from, date_to: next.date_to })
            }
            actions={<CollectionActions onResetFilters={resetFilters} disabled={loading} />}
          />
        }
        table={
          <Table<InventoryOperationItem>
            columns={columns}
            data={items}
            loading={loading}
            sort={query.sort}
            onSortClick={cycleSortField}
            wrapClassName="product-table-wrap"
            rowMeta={(row) => getInventoryOpListRowPresentation(opType, row)}
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
