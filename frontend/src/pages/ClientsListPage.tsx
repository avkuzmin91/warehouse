import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ListPagination } from '../components/ListPagination'
import { Table, type TableColumn } from '../components/Table'
import { useQueryState } from '../hooks/useQueryState'
import { getClients } from '../api'
import type { DictionaryItem } from '../api'

const CLIENT_FILTER_KEYS = ['search', 'is_active'] as const

const clientFilterFields: FilterFieldConfig[] = [
  { name: 'search', type: 'text', placeholder: 'Поиск...' },
  {
    name: 'is_active',
    type: 'select',
    options: [
      { value: '', label: 'Статус' },
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

export function ClientsListPage() {
  const navigate = useNavigate()
  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys: CLIENT_FILTER_KEYS })

  const [items, setItems] = useState<DictionaryItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

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
      is_active: apiParams.is_active,
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
  }, [apiParams, query.limit, query.page, setPage])

  return (
    <main className="page page--center">
      <section className="auth-card users-card product-dict-card">
        <Breadcrumbs />

        <FiltersPanel
          fields={clientFilterFields}
          values={{
            search: query.filters.search,
            is_active: query.filters.is_active,
          }}
          onTextFilterDebounced={(name, value) => {
            if (name === 'search') setFilters({ search: value || undefined })
          }}
          onSelectChange={(_name, value) => {
            setFilters({
              is_active: value === null || value === undefined ? undefined : Boolean(value),
            })
          }}
          actions={
            <CollectionActions
              createHref="/dictionaries/clients/new"
              onResetFilters={resetFilters}
            />
          }
        />

        <Table<DictionaryItem>
          columns={clientColumns}
          data={items}
          loading={loading}
          onRowClick={(row) => navigate(`/dictionaries/clients/${row.id}`)}
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
      </section>
    </main>
  )
}
