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
  buildActualityFilterSelectOptions,
  fetchRecordActualityFilterItems,
  getClients,
  type DictionaryItem,
  type RecordActualityFilterItem,
} from '../api'

const CLIENT_FILTER_KEYS = ['search', 'actuality_id', 'date_from', 'date_to'] as const

function clientFilterFields(actualityItems: RecordActualityFilterItem[]): FilterFieldConfig[] {
  return [
    { name: 'search', type: 'text', placeholder: 'Поиск...' },
    {
      name: 'actuality_id',
      type: 'dictionary_autocomplete',
      options: buildActualityFilterSelectOptions(actualityItems, 'Актуальность'),
    },
    { type: 'date_range', placeholder: 'Дата создания' },
  ]
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

export function ClientsListPage() {
  const navigate = useNavigate()
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys: CLIENT_FILTER_KEYS })

  const [items, setItems] = useState<DictionaryItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [actualityItems, setActualityItems] = useState<RecordActualityFilterItem[]>([])

  useEffect(() => {
    let cancelled = false
    fetchRecordActualityFilterItems()
      .then((rows) => {
        if (!cancelled) setActualityItems(rows)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filterFields = useMemo(() => clientFilterFields(actualityItems), [actualityItems])

  const clientColumns: TableColumn<DictionaryItem>[] = useMemo(
    () => [
      { key: 'name', title: 'Название клиента', sortable: true },
      {
        key: 'is_active',
        title: 'Статус',
        sortable: true,
        render: (_, row) => (row.is_active ? 'Актуален' : 'Не актуален'),
      },
      {
        key: 'created_at',
        title: 'Дата создания',
        sortable: true,
        render: (v) => formatDateDdMmYyyy(String(v)),
      },
    ],
    [],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getClients({
      page: apiParams.page,
      limit: apiParams.limit,
      search: apiParams.search,
      actuality_id: apiParams.actuality_id,
      date_from: apiParams.date_from,
      date_to: apiParams.date_to,
      sort: apiParams.sort,
    })
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
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
      wrapWithPageContainer
      pageContainerProps={{ cardClassName: 'users-card product-dict-card' }}
      breadcrumbs={<Breadcrumbs />}
      filters={
        <FiltersPanel
          disabled={loading}
          fields={filterFields}
          values={{
            search: query.filters.search,
            actuality_id: query.filters.actuality_id,
            date_from: query.filters.date_from,
            date_to: query.filters.date_to,
          }}
          onTextFilterDebounced={(name, value) => {
            if (name === 'search') setFilters({ search: value || undefined })
          }}
          onSelectChange={(name, value) => {
            if (name === 'actuality_id') {
              setFilters({ actuality_id: value ?? undefined })
            }
          }}
          onDateRangeChange={(next) =>
            setFilters({ date_from: next.date_from, date_to: next.date_to })
          }
          actions={
            <CollectionActions
              createHref="/dictionaries/clients/new"
              onResetFilters={resetFilters}
              disabled={loading}
            />
          }
        />
      }
      table={
        <Table<DictionaryItem>
          columns={clientColumns}
          data={items}
          loading={loading}
          onRowClick={(row) => navigate(`/dictionaries/clients/${row.id}`)}
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
