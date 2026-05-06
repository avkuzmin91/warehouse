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
  simpleDictionaryDefinition,
  type SimpleDictionaryEntityKey,
} from '../config/simpleDictionaryConfig'
import {
  buildActualityFilterSelectOptions,
  fetchProductTypesPage,
  fetchRecordActualityFilterItems,
  fetchSimpleDictionaryPage,
  type DictionaryItem,
  type ProductTypeDictionaryItem,
  type RecordActualityFilterItem,
  type SimpleDictionaryListParams,
} from '../api'

const SIMPLE_DICT_FILTER_KEYS = ['name', 'actuality_id', 'date_from', 'date_to'] as const

function filterFields(actualityItems: RecordActualityFilterItem[]): FilterFieldConfig[] {
  return [
    { name: 'name', type: 'text', placeholder: 'Поиск по названию' },
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

export type SimpleDictionaryListPageProps = {
  entity: SimpleDictionaryEntityKey
}

export function SimpleDictionaryListPage({ entity }: SimpleDictionaryListPageProps) {
  const def = simpleDictionaryDefinition(entity)
  const navigate = useNavigate()
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys: SIMPLE_DICT_FILTER_KEYS })

  const [items, setItems] = useState<(DictionaryItem | ProductTypeDictionaryItem)[]>([])
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

  const fields = useMemo(() => filterFields(actualityItems), [actualityItems])

  const columns: TableColumn<DictionaryItem | ProductTypeDictionaryItem>[] = useMemo(() => {
    const base: TableColumn<DictionaryItem | ProductTypeDictionaryItem>[] = [
      { key: 'name', title: 'Название', sortable: true },
    ]
    if (entity === 'product-types') {
      base.push(
        {
          key: 'requires_color',
          title: 'Учёт по цвету',
          sortable: false,
          render: (_, row) =>
            'requires_color' in row && row.requires_color ? 'Да' : 'Нет',
        },
        {
          key: 'requires_size',
          title: 'Учёт по размеру',
          sortable: false,
          render: (_, row) =>
            'requires_size' in row && row.requires_size ? 'Да' : 'Нет',
        },
      )
    }
    base.push(
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
    )
    return base
  }, [entity])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    const listParams: SimpleDictionaryListParams = {
      page: apiParams.page,
      limit: apiParams.limit,
      actuality_id: apiParams.actuality_id,
      sort: apiParams.sort,
      date_from: apiParams.date_from,
      date_to: apiParams.date_to,
    }
    if (def.listNameQueryKey === 'name') {
      listParams.name = apiParams.name
    } else {
      listParams.search = apiParams.search
    }

    const listPromise =
      entity === 'product-types'
        ? fetchProductTypesPage(listParams)
        : fetchSimpleDictionaryPage(def.apiPath, def.listNameQueryKey, listParams)

    listPromise
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
  }, [apiParams, def.apiPath, def.listNameQueryKey, entity, query.limit, query.page, setPage, reloadKey])

  const basePath = `/dictionaries/${def.routeSegment}`

  return (
    <ListPageLayout
      wrapWithPageContainer
      pageContainerProps={{ cardClassName: 'users-card product-dict-card' }}
      breadcrumbs={<Breadcrumbs />}
      filters={
        <FiltersPanel
          disabled={loading}
          fields={fields}
          values={{
            name: query.filters.name,
            actuality_id: query.filters.actuality_id,
            date_from: query.filters.date_from,
            date_to: query.filters.date_to,
          }}
          onTextFilterDebounced={(name, value) => {
            if (name === 'name') setFilters({ name: value || undefined })
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
              createHref={`${basePath}/new`}
              onResetFilters={resetFilters}
              disabled={loading}
            />
          }
        />
      }
      table={
        <Table<DictionaryItem | ProductTypeDictionaryItem>
          columns={columns}
          data={items}
          loading={loading}
          onRowClick={(row) => navigate(`${basePath}/${row.id}`)}
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
