import { useEffect, useMemo, useState } from 'react'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ImageFullscreenLightbox } from '../components/ImageFullscreenLightbox'
import { ListPageLayout } from '../components/ListPageLayout'
import { ListPagination } from '../components/ListPagination'
import { Table, type TableColumn } from '../components/Table'
import { useQueryState } from '../hooks/useQueryState'
import {
  type DictionaryItem,
  type InventoryBalanceItem,
  getInventoryBalances,
  getInventoryClients,
  getInventoryColors,
  getInventorySizes,
} from '../api/inventoryApi'
import { resolvePublicUploadSrc } from '../api/constants'

const FILTER_KEYS = [
  'client_id',
  'sku',
  'name',
  'color_id',
  'size_id',
  'has_defect',
  'has_uninspected',
  'no_good',
  'only_defect',
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
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])

  useEffect(() => {
    let cancelled = false
    Promise.all([getInventoryClients(), getInventoryColors(), getInventorySizes()])
      .then(([cs, cls, szs]) => {
        if (cancelled) return
        setClients(cs)
        setColors(cls)
        setSizes(szs)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const filterFields: FilterFieldConfig[] = useMemo(
    () => [
      { name: 'client_id', type: 'dictionary_autocomplete', options: dictOptions(clients, 'Клиент') },
      { name: 'sku', type: 'text', placeholder: 'Штрих-код' },
      { name: 'name', type: 'text', placeholder: 'Название' },
      { name: 'color_id', type: 'dictionary_autocomplete', options: dictOptions(colors, 'Цвет') },
      { name: 'size_id', type: 'dictionary_autocomplete', options: dictOptions(sizes, 'Размер') },
      {
        name: 'only_defect',
        type: 'dictionary_autocomplete',
        options: [
          { value: '', label: 'Все типы' },
          { value: 'true', label: 'Только брак' },
        ],
      },
      {
        name: 'has_defect',
        type: 'dictionary_autocomplete',
        options: [
          { value: '', label: 'Наличие брака' },
          { value: 'true', label: 'Есть брак' },
        ],
      },
      {
        name: 'has_uninspected',
        type: 'dictionary_autocomplete',
        options: [
          { value: '', label: 'Непроверенное' },
          { value: 'true', label: 'Есть непроверенное' },
        ],
      },
      {
        name: 'no_good',
        type: 'dictionary_autocomplete',
        options: [
          { value: '', label: 'Годный товар' },
          { value: 'true', label: 'Нет годного товара' },
        ],
      },
    ],
    [clients, colors, sizes],
  )

  const columns: TableColumn<InventoryBalanceItem>[] = useMemo(
    () => [
      {
        key: 'product_sku',
        title: 'Штрих-код',
        sortable: true,
        render: (_v, row) => (String(row.product_sku ?? '').trim() ? String(row.product_sku) : '—'),
      },
      {
        key: 'product_name',
        title: 'Название',
        sortable: true,
        render: (v) => (String(v || '').trim() ? String(v) : '—'),
      },
      { key: 'client_name', title: 'Клиент', sortable: true, render: (v) => (v as string) || '—' },
      {
        key: 'preview_image_url',
        title: 'Фото',
        sortable: false,
        render: (_v, row) => {
          const raw = row.preview_image_url
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
              aria-label="Открыть фото"
            >
              <img src={src} alt="" className="product-thumb" width={40} height={40} loading="lazy" />
            </button>
          )
        },
      },
      { key: 'color_name', title: 'Цвет', sortable: true, render: (v) => (v as string) || '—' },
      {
        key: 'size_name',
        title: 'Размер',
        sortable: true,
        render: (v) => ((v as string)?.trim() ? String(v) : '—'),
      },
      {
        key: 'quantity',
        title: 'Всего',
        sortable: true,
        render: (v) => {
          const n = Math.max(0, Number(v) || 0)
          const cls = n <= 0 ? 'qty-zero' : 'qty-positive'
          return <span className={cls}>{n}</span>
        },
      },
      {
        key: 'good_qty',
        title: 'Годный',
        sortable: false,
        render: (_v, row) => {
          const n = Math.max(0, Number(row.good_qty) || 0)
          return <span className={n > 0 ? 'qty-positive' : 'qty-zero'}>{n}</span>
        },
      },
      {
        key: 'defect_qty',
        title: 'Брак',
        sortable: false,
        render: (_v, row) => {
          const n = Math.max(0, Number(row.defect_qty) || 0)
          return <span className={n > 0 ? 'balance-defect-qty' : 'qty-zero'}>{n}</span>
        },
      },
      {
        key: 'uninspected_qty',
        title: 'Не проверено',
        sortable: false,
        render: (_v, row) => {
          const n = Math.max(0, Number(row.uninspected_qty) || 0)
          return <span className={n > 0 ? 'balance-uninspected-qty' : 'qty-zero'}>{n}</span>
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
      color_id: apiParams.color_id,
      size_id: apiParams.size_id,
      sku: apiParams.sku,
      name: apiParams.name,
      only_positive: true,
      has_defect: apiParams.has_defect === 'true' ? true : undefined,
      has_uninspected: apiParams.has_uninspected === 'true' ? true : undefined,
      no_good: apiParams.no_good === 'true' ? true : undefined,
      only_defect: apiParams.only_defect === 'true' ? true : undefined,
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

  const onTextFilterDebounced = (name: 'search' | 'name' | 'sku' | 'supplier', value: string) => {
    const v = value || undefined
    if (name === 'sku') setFilters({ sku: v })
    if (name === 'name') setFilters({ name: v })
  }

  return (
    <>
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
              sku: query.filters.sku,
              name: query.filters.name,
              color_id: query.filters.color_id,
              size_id: query.filters.size_id,
              only_defect: query.filters.only_defect,
              has_defect: query.filters.has_defect,
              has_uninspected: query.filters.has_uninspected,
              no_good: query.filters.no_good,
            }}
            onTextFilterDebounced={onTextFilterDebounced}
            onSelectChange={(name, value) => {
              if (
                name === 'client_id' ||
                name === 'color_id' ||
                name === 'size_id' ||
                name === 'only_defect' ||
                name === 'has_defect' ||
                name === 'has_uninspected' ||
                name === 'no_good'
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
      <ImageFullscreenLightbox
        open={lightboxSrc !== null}
        src={lightboxSrc}
        onClose={() => setLightboxSrc(null)}
      />
    </>
  )
}
