import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  type InventoryOperationItem,
  type InventoryOpType,
  getInventoryClients,
  getInventoryColors,
  getInventoryOperations,
  getInventorySizes,
  resolvePublicUploadSrc,
} from '../api'

const FILTER_KEYS_RECEIPTS = [
  'client_id',
  'sku',
  'name',
  'color_id',
  'size_id',
  'receipt_status',
  'date_from',
  'date_to',
] as const

const FILTER_KEYS_SHIPMENTS = [
  'client_id',
  'sku',
  'name',
  'color_id',
  'size_id',
  'shipment_status',
  'date_from',
  'date_to',
] as const

function dictOptions(items: { id: string; name: string }[], placeholder: string) {
  return [{ value: '', label: placeholder }, ...items.map((i) => ({ value: i.id, label: i.name }))]
}

function formatDateDdMmYyyy(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function InventoryOperationsListPage({ opType }: { opType: InventoryOpType }) {
  const navigate = useNavigate()
  const isShipment = opType === 'out'
  const filterKeys = isShipment ? FILTER_KEYS_SHIPMENTS : FILTER_KEYS_RECEIPTS

  const { query, apiParams, setFilters, setPage, setLimit, cycleSortField, resetFilters } =
    useQueryState({ filterKeys })

  const [items, setItems] = useState<InventoryOperationItem[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [colors, setColors] = useState<DictionaryItem[]>([])
  const [sizes, setSizes] = useState<DictionaryItem[]>([])
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const createHref = isShipment ? '/inventory/shipments/new' : '/inventory/receipts/new'

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

  const filterFields: FilterFieldConfig[] = useMemo(() => {
    if (!isShipment) {
      return [
        { type: 'date_range', placeholder: 'Дата поступления' },
        { name: 'client_id', type: 'dictionary_autocomplete', options: dictOptions(clients, 'Клиент') },
        { name: 'sku', type: 'text', placeholder: 'Артикул' },
        { name: 'name', type: 'text', placeholder: 'Название' },
        {
          name: 'receipt_status',
          type: 'select',
          options: [
            { value: '', label: 'Статус' },
            { value: 'pending', label: 'Ожидает приемки' },
            { value: 'accepted', label: 'Принят' },
          ],
        },
        { name: 'color_id', type: 'dictionary_autocomplete', options: dictOptions(colors, 'Цвет') },
        { name: 'size_id', type: 'dictionary_autocomplete', options: dictOptions(sizes, 'Размер') },
      ]
    }
    return [
      { type: 'date_range', placeholder: 'Дата отгрузки (регистрация)' },
      { name: 'client_id', type: 'dictionary_autocomplete', options: dictOptions(clients, 'Клиент') },
      { name: 'sku', type: 'text', placeholder: 'Артикул' },
      { name: 'name', type: 'text', placeholder: 'Название' },
      {
        name: 'shipment_status',
        type: 'select',
        options: [
          { value: '', label: 'Статус' },
          { value: 'pending', label: 'Ожидает отгрузки' },
          { value: 'shipped', label: 'Отгружен' },
        ],
      },
      { name: 'color_id', type: 'dictionary_autocomplete', options: dictOptions(colors, 'Цвет') },
      { name: 'size_id', type: 'dictionary_autocomplete', options: dictOptions(sizes, 'Размер') },
    ]
  }, [isShipment, clients, colors, sizes])

  const columns: TableColumn<InventoryOperationItem>[] = useMemo(() => {
    if (!isShipment) {
      return [
        {
          key: 'created_at',
          title: 'Дата',
          sortable: true,
          render: (v) => formatDateDdMmYyyy(String(v)),
        },
        {
          key: 'receipt_status',
          title: 'Статус',
          sortable: true,
          render: (_v, row) => {
            const s = row.receipt_status
            if (s === 'pending') return 'Ожидает приемки'
            if (s === 'accepted') return 'Принят'
            return '—'
          },
        },
        { key: 'client_name', title: 'Клиент', sortable: true, render: (v) => (v as string) || '—' },
        {
          key: 'product_sku',
          title: 'Артикул',
          sortable: true,
          render: (_v, row) => (row.product_sku as string) || '—',
        },
        {
          key: 'product_name',
          title: 'Название',
          sortable: true,
          render: (v) => (String(v || '').trim() ? String(v) : '—'),
        },
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
        { key: 'size_name', title: 'Размер', sortable: true, render: (v) => (v as string) || '—' },
        { key: 'quantity', title: 'Количество', sortable: true },
      ]
    }
    return [
      {
        key: 'created_at',
        title: 'Дата',
        sortable: true,
        render: (v) => formatDateDdMmYyyy(String(v)),
      },
      {
        key: 'shipment_status',
        title: 'Статус',
        sortable: true,
        render: (_v, row) => {
          const s = row.shipment_status
          if (s === 'pending') return 'Ожидает отгрузки'
          if (s === 'shipped') return 'Отгружен'
          return '—'
        },
      },
      { key: 'client_name', title: 'Клиент', sortable: true, render: (v) => (v as string) || '—' },
      {
        key: 'product_sku',
        title: 'Артикул',
        sortable: true,
        render: (_v, row) => (row.product_sku as string) || '—',
      },
      {
        key: 'product_name',
        title: 'Название',
        sortable: true,
        render: (v) => (String(v || '').trim() ? String(v) : '—'),
      },
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
      { key: 'size_name', title: 'Размер', sortable: true, render: (v) => (v as string) || '—' },
      { key: 'quantity', title: 'Количество', sortable: true },
    ]
  }, [isShipment])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getInventoryOperations({
      page: apiParams.page,
      limit: apiParams.limit,
      op_type: opType,
      client_id: apiParams.client_id,
      color_id: apiParams.color_id,
      size_id: apiParams.size_id,
      sku: apiParams.sku,
      name: apiParams.name,
      receipt_status: apiParams.receipt_status,
      shipment_status: apiParams.shipment_status,
      date_from: apiParams.date_from,
      date_to: apiParams.date_to,
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

  const onTextFilterDebounced = (name: 'search' | 'name' | 'sku' | 'supplier', value: string) => {
    const v = value || undefined
    if (name === 'sku') setFilters({ sku: v })
    if (name === 'name') setFilters({ name: v })
  }

  const filterValues = isShipment
    ? {
        client_id: query.filters.client_id,
        sku: query.filters.sku,
        name: query.filters.name,
        color_id: query.filters.color_id,
        size_id: query.filters.size_id,
        shipment_status: query.filters.shipment_status,
        date_from: query.filters.date_from,
        date_to: query.filters.date_to,
      }
    : {
        client_id: query.filters.client_id,
        sku: query.filters.sku,
        name: query.filters.name,
        color_id: query.filters.color_id,
        size_id: query.filters.size_id,
        receipt_status: query.filters.receipt_status,
        date_from: query.filters.date_from,
        date_to: query.filters.date_to,
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
          values={filterValues}
          onTextFilterDebounced={onTextFilterDebounced}
          onSelectChange={(name, value) => {
            if (name === 'client_id') {
              setFilters({ client_id: value ?? undefined })
            } else if (
              name === 'color_id' ||
              name === 'size_id' ||
              name === 'receipt_status' ||
              name === 'shipment_status'
            ) {
              setFilters({ [name]: value ?? undefined })
            }
          }}
          onDateRangeChange={(next) =>
            setFilters({ date_from: next.date_from ?? undefined, date_to: next.date_to ?? undefined })
          }
          actions={
            <CollectionActions
              createHref={createHref}
              onResetFilters={resetFilters}
              disabled={loading}
              createLabel={isShipment ? 'Новая отгрузка' : 'Новое поступление'}
            />
          }
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
          rowClassName={(row) => {
            if (!isShipment) {
              const s = row.receipt_status
              if (s === 'pending') return 'inv-receipt-row inv-receipt-row--pending'
              if (s === 'accepted') return 'inv-receipt-row inv-receipt-row--accepted'
              return undefined
            }
            const s = row.shipment_status
            if (s === 'pending') return 'inv-shipment-row inv-shipment-row--pending'
            if (s === 'shipped') return 'inv-shipment-row inv-shipment-row--shipped'
            return undefined
          }}
          onRowClick={(row) => {
            if (!isShipment) {
              navigate(`/inventory/receipts/${row.id}`)
            } else {
              navigate(`/inventory/shipments/${row.id}`)
            }
          }}
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
