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
  getSizes,
  type RecordActualityFilterItem,
  type SizeItem,
} from '../api'

const SIZE_FILTER_KEYS = ['name', 'actuality_id'] as const

function sizeFilterFields(actualityItems: RecordActualityFilterItem[]): FilterFieldConfig[] {
  return [
    { name: 'name', type: 'text', placeholder: 'Поиск по названию' },
    {
      name: 'actuality_id',
      type: 'dictionary_autocomplete',
      options: buildActualityFilterSelectOptions(actualityItems, 'Актуальность'),
    },
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

export function SizesListPage() {
  const navigate = useNavigate()
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys: SIZE_FILTER_KEYS })

  const [items, setItems] = useState<SizeItem[]>([])
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

  const filterFields = useMemo(() => sizeFilterFields(actualityItems), [actualityItems])

  const sizeColumns: TableColumn<SizeItem>[] = useMemo(
    () => [
      { key: 'name', title: 'Название размера', sortable: true },
      {
        key: 'is_active',
        title: 'Актуален',
        sortable: true,
        render: (_, row) => (row.is_active ? 'Да' : 'Нет'),
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
    getSizes({
      page: apiParams.page,
      limit: apiParams.limit,
      name: apiParams.name,
      actuality_id: apiParams.actuality_id,
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
            name: query.filters.name,
            actuality_id: query.filters.actuality_id,
          }}
          onTextFilterDebounced={(name, value) => {
            if (name === 'name') setFilters({ name: value || undefined })
          }}
          onSelectChange={(name, value) => {
            if (name === 'actuality_id') {
              setFilters({ actuality_id: value ?? undefined })
            }
          }}
          actions={
            <CollectionActions
              createHref="/dictionaries/sizes/new"
              onResetFilters={resetFilters}
              disabled={loading}
            />
          }
        />
      }
      table={
        <Table<SizeItem>
          columns={sizeColumns}
          data={items}
          loading={loading}
          onRowClick={(row) => navigate(`/dictionaries/sizes/${row.id}`)}
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
