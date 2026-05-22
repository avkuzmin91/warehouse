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
import { getInventoryOpListRowPresentation } from '../utils/inventoryOperationRowVisual'
import '../components/InventoryProductStyles.css'
import {
  type DictionaryItem,
  type InventoryOperationItem,
  type InventoryOpType,
  getInventoryClients,
  getInventoryColors,
  getInventoryOperations,
  getInventorySizes,
} from '../api/inventoryApi'
import { resolvePublicUploadSrc } from '../api/constants'

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
        { type: 'date_range', placeholder: 'Дата' },
        { name: 'client_id', type: 'dictionary_autocomplete', options: dictOptions(clients, 'Клиент') },
        { name: 'sku', type: 'text', placeholder: 'Штрих-код' },
        { name: 'name', type: 'text', placeholder: 'Название' },
        {
          name: 'receipt_status',
          type: 'dictionary_autocomplete',
          options: [
            { value: '', label: 'Статус' },
            { value: 'pending', label: 'Ожидает поступления' },
            { value: 'awaiting_inspection', label: 'Ожидает проверки' },
            { value: 'partially_inspected', label: 'Частично проверено' },
            { value: 'inspected', label: 'Проверено' },
            { value: 'accepted', label: 'Принят (устар.)' },
          ],
        },
        { name: 'color_id', type: 'dictionary_autocomplete', options: dictOptions(colors, 'Цвет') },
        { name: 'size_id', type: 'dictionary_autocomplete', options: dictOptions(sizes, 'Размер') },
      ]
    }
    return [
      { type: 'date_range', placeholder: 'Дата' },
      { name: 'client_id', type: 'dictionary_autocomplete', options: dictOptions(clients, 'Клиент') },
      { name: 'sku', type: 'text', placeholder: 'Штрих-код' },
      { name: 'name', type: 'text', placeholder: 'Название' },
      {
        name: 'shipment_status',
        type: 'dictionary_autocomplete',
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
            if (s === 'pending') return 'Ожидает поступления'
            if (s === 'accepted') return 'Принят'
            if (s === 'awaiting_inspection') return 'Ожидает проверки'
            if (s === 'partially_inspected') return 'Частично проверено'
            if (s === 'inspected') return 'Проверено'
            return '—'
          },
        },
        { key: 'client_name', title: 'Клиент', sortable: true, render: (v) => (v as string) || '—' },
        {
          key: 'product_sku',
          title: 'Штрих-код',
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
      {
        key: 'shipment_type',
        title: 'Тип',
        sortable: false,
        render: (_v, row) => {
          const t = row.shipment_type
          if (t === 'defect') {
            return <span className="shipment-type-badge shipment-type-badge--defect">🔴 Брак</span>
          }
          return <span className="shipment-type-badge shipment-type-badge--standard">🟢 Годный</span>
        },
      },
      { key: 'client_name', title: 'Клиент', sortable: true, render: (v) => (v as string) || '—' },
      {
        key: 'product_sku',
        title: 'Штрих-код',
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
      pageContainerProps={{ cardClassName: 'users-card product-dict-card inv-operations-list' }}
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
              beforeCreate={
                <button
                  type="button"
                  className="btn btn--secondary collection-actions__icon-btn collection-actions__import-excel"
                  aria-label="Импорт Excel"
                  title="Импорт Excel"
                  disabled={loading}
                  onClick={() =>
                    navigate(isShipment ? '/inventory/shipments/import/excel' : '/inventory/receipts/import/excel')
                  }
                >
                  <svg className="collection-actions__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              }
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
          rowMeta={(row) => getInventoryOpListRowPresentation(isShipment ? 'out' : 'in', row)}
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
