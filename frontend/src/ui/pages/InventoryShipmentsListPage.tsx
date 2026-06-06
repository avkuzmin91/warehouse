import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listShipments,
  advanceShipment,
  isShipmentOverdue,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
  SHIPMENT_STATUS_ORDER,
} from '../../api/shipmentsApi'
import type { ShipmentListItem, ShipmentStatus } from '../../api/shipmentsApi'
import { ShipmentLinesView } from '../features/inventory/ShipmentLinesView'
import { ListPage } from '../layouts/ListPage'
import { Table, Td } from '../data/Table'
import { Pagination } from '../data/Pagination'
import { FiltersBar, FilterSelect, FilterCombobox } from '../data/FiltersBar'
import { DateRange } from '../data/DateRange'
import { Badge } from '../primitives/Badge'
import type { BadgeTone } from '../primitives/Badge'
import { Icon } from '../primitives/Icon'
import { SkeletonRows } from '../primitives/Skeleton'
import { EmptyState } from '../primitives/EmptyState'
import { fmtDateShort as fmtDate } from '../../utils/format'
import { useLookups } from '../../hooks/useLookups'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../hooks/useFilterParams'
import { canEditShipments } from '../../utils/access'

const PAGE_SIZE = 25

type ModeId = 'docs' | 'items'

const MODE_TABS: { id: ModeId; label: string }[] = [
  { id: 'docs',  label: 'По документам' },
  { id: 'items', label: 'По товарам' },
]

const KANBAN_COLS: { status: ShipmentStatus; label: string; tone: BadgeTone }[] = [
  { status: 'draft',   label: 'Создание',  tone: '' },
  { status: 'packing', label: 'В плане',   tone: 'info' },
  { status: 'shipped', label: 'Завершён',  tone: 'success' },
]

const ADVANCE_LABELS: Partial<Record<ShipmentStatus, string>> = {
  draft:   'В план',
}

function shipmentProgress(item: ShipmentListItem) {
  const totalQty = item.total_qty || 0
  const shippedQty = item.total_shipped_qty ?? 0
  const pct = totalQty > 0
    ? Math.min(100, Math.floor(shippedQty / totalQty * 100))
    : 0
  const linesCount = item.sku_count || 0
  const qtyReady = linesCount > 0 && (item.lines_with_shipped_qty ?? 0) === linesCount
  const zoneReady = item.cargo_type !== 'good' || (linesCount > 0 && (item.lines_with_zone ?? 0) === linesCount)
  return { pct, shippedQty, totalQty, qtyReady, zoneReady }
}

export function InventoryShipmentsListPage() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const canEdit = canEditShipments(user)

  const [mode, setMode] = useFilterParam('mode', 'docs')
  const [search, setSearch] = useFilterParam('search', '')
  const [skuFilter, setSkuFilter] = useFilterParam('sku', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [statusFilter, setStatusFilter] = useFilterParam('status', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [view, setView] = useFilterParam('view', 'table')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

  const [items, setItems] = useState<ShipmentListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [advancingId, setAdvancingId] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const { clients } = useLookups()

  const isOverdueFilter = statusFilter === 'overdue'
  const statusParam: ShipmentStatus | ShipmentStatus[] | undefined =
    !statusFilter || isOverdueFilter
      ? undefined
      : statusFilter.includes(',')
        ? (statusFilter.split(',') as ShipmentStatus[])
        : (statusFilter as ShipmentStatus)
  const overdueParam = isOverdueFilter || undefined

  useEffect(() => {
    if (mode !== 'docs' || view !== 'table') {
      setInitialLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    listShipments({
      page, limit: PAGE_SIZE,
      search: search.trim() || undefined,
      sku: skuFilter.trim() || undefined,
      client_id: clientId || undefined,
      status: statusParam,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      overdue: overdueParam,
    }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return
        setItems(res.items)
        setTotal(res.total)
      })
      .catch((e) => { if (!ctrl.signal.aborted) console.error(e) })
      .finally(() => {
        if (ctrl.signal.aborted) return
        setLoading(false)
        setInitialLoading(false)
      })
    return () => ctrl.abort()
  }, [mode, view, page, search, skuFilter, clientId, statusFilter, dateFrom, dateTo, reloadTick])

  async function handleAdvance(e: React.MouseEvent, item: ShipmentListItem) {
    e.stopPropagation()
    setAdvancingId(item.id)
    try {
      await advanceShipment(item.id)
      setReloadTick((t) => t + 1)
    } finally {
      setAdvancingId(null)
    }
  }

  if (initialLoading) {
    return (
      <ListPage title="Отгрузки">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
          <div style={{ width: 28, height: 28, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      </ListPage>
    )
  }

  return (
    <ListPage
      title="Отгрузки"
      subtitle={mode === 'docs' ? `Всего: ${total}` : undefined}
      actions={
        <>
          {mode === 'docs' && (
            <div style={{ display: 'flex', background: 'var(--c-bg-sunken)', padding: 3, borderRadius: 6, gap: 2 }}>
              <button
                className="btn ghost sm"
                style={{ background: view === 'table' ? 'var(--c-bg-elev)' : 'transparent', boxShadow: view === 'table' ? 'var(--sh-1)' : 'none' }}
                onClick={() => setView('table')}
              ><Icon name="list" size={13} />Список</button>
              <button
                className="btn ghost sm"
                style={{ background: view === 'kanban' ? 'var(--c-bg-elev)' : 'transparent', boxShadow: view === 'kanban' ? 'var(--sh-1)' : 'none' }}
                onClick={() => setView('kanban')}
              ><Icon name="grid" size={13} />Канбан</button>
            </div>
          )}
          {canEdit && (
            <button className="btn primary" onClick={() => navigate('/inventory/shipments/new')}>
              <Icon name="plus" size={14} />Новая отгрузка
            </button>
          )}
        </>
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Номер, клиент, назначение…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => setSearch('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="tag" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 160, paddingRight: skuFilter ? 26 : undefined }}
              placeholder="SKU товара…"
              value={skuFilter}
              onChange={(e) => setSkuFilter(e.target.value)}
            />
            {skuFilter && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => setSkuFilter('')}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setClientId(v)}
            placeholder="Поиск клиента…"
          />
          <DateRange
            from={dateFrom} to={dateTo}
            onFromChange={(v) => setDateFrom(v)}
            onToChange={(v) => setDateTo(v)}
            onClear={() => setMany({ from: '', to: '' })}
          />
          <FilterSelect
            label="Статус"
            value={statusFilter}
            options={[
              { value: '', label: 'Все статусы' },
              { value: 'overdue', label: 'Просрочка' },
              ...([...SHIPMENT_STATUS_ORDER, 'cancelled'] as ShipmentStatus[])
                .map((s) => ({ value: s, label: SHIPMENT_STATUS_LABELS[s] })),
              { value: 'shipped,cancelled', label: 'Завершённые' },
            ]}
            onChange={(v) => setStatusFilter(v)}
          />
          {(clientId || skuFilter || dateFrom || dateTo || statusFilter) && (
            <button className="btn ghost sm" onClick={() => setMany({ client: '', sku: '', from: '', to: '', status: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          <button
            className="btn ghost sm icon"
            title="Обновить"
            onClick={() => setReloadTick((t) => t + 1)}
          >
            <Icon name="refresh" size={14} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          </button>
        </FiltersBar>
      }
    >
      <div className="tabs" style={{ marginBottom: 14 }}>
        {MODE_TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${mode === t.id ? ' active' : ''}`}
            onClick={() => setMode(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'items' ? (
        <ShipmentLinesView
          search={search}
          sku={skuFilter}
          clientId={clientId}
          status={statusParam}
          overdue={overdueParam}
          dateFrom={dateFrom}
          dateTo={dateTo}
          page={page}
          onPage={setPage}
        />
      ) : view === 'table' ? (
        <>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th style={{ width: 120 }}>Номер</th>
                <th>Клиент</th>
                <th>Назначение</th>
                <th style={{ width: 110 }}>Дата отгрузки</th>
                <th style={{ textAlign: 'right', width: 60 }}>SKU</th>
                <th style={{ textAlign: 'right', width: 80 }}>План</th>
                <th style={{ textAlign: 'right', width: 80 }}>Факт</th>
                <th style={{ width: 130 }}>Перевозчик</th>
                <th style={{ width: 130 }}>Статус</th>
                <th style={{ width: 150 }}>Выполнение</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={11} />
              ) : items.length === 0 ? (
                <tr><td colSpan={11}>
                  <EmptyState
                    title={isOverdueFilter ? 'Просроченных отгрузок нет' : 'Отгрузок нет'}
                    sub={!statusFilter ? 'Создайте первую отгрузку' : undefined}
                  />
                </td></tr>
              ) : (
                items.map((item) => {
                  const overdue = isShipmentOverdue(item)
                  return (
                    <tr
                      key={item.id}
                      style={{
                        cursor: 'pointer',
                        ...(overdue ? {
                          background: 'color-mix(in oklab, var(--c-danger) 5%, transparent)',
                          borderLeft: '2px solid var(--c-danger)',
                        } : {}),
                      }}
                      onClick={() => navigate(`/inventory/shipments/${item.id}`)}
                    >
                      <Td style={{ paddingLeft: overdue ? 6 : 8 }}>
                        {overdue && (
                          <Icon name="alert" size={14} style={{ color: 'var(--c-danger)' }} title="Просрочена" />
                        )}
                      </Td>
                      <Td className="mono" style={{ fontWeight: 500 }}>
                        {item.doc_number}
                        {overdue && (
                          <div style={{ fontSize: 11, color: 'var(--c-danger)', fontWeight: 500, marginTop: 2 }}>
                            просрочена
                          </div>
                        )}
                      </Td>
                      <Td>{item.client_name ?? '—'}</Td>
                      <Td className="t-sub">{item.destination ?? '—'}</Td>
                      <Td className="mono" style={overdue ? { color: 'var(--c-danger)', fontWeight: 500 } : {}}>
                        {fmtDate(item.ship_date)}
                      </Td>
                      <Td className="num">{item.sku_count}</Td>
                      <Td className="num">{item.total_qty.toLocaleString('ru-RU')}</Td>
                      <Td className="num">{(item.total_shipped_qty ?? 0).toLocaleString('ru-RU')}</Td>
                      <Td>{item.carrier ?? '—'}</Td>
                      <Td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Badge tone={SHIPMENT_STATUS_TONES[item.status] as BadgeTone} dot>
                            {item.status_label}
                          </Badge>
                          {canEdit && ADVANCE_LABELS[item.status] && (
                            <button
                              className="btn ghost sm"
                              disabled={advancingId === item.id}
                              onClick={(e) => handleAdvance(e, item)}
                              title={ADVANCE_LABELS[item.status]}
                            >
                              <Icon name="chev" size={13} style={{ transform: 'rotate(-90deg)' }} />
                            </button>
                          )}
                        </div>
                      </Td>
                      <Td>
                        {(() => {
                          const isActive = item.status === 'packing' || item.status === 'shipped'
                          if (!isActive) return <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
                          const progress = shipmentProgress(item)
                          const complete = progress.pct >= 100
                          return (
                            <div style={{ minWidth: 120 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--c-border-strong)', overflow: 'hidden' }}>
                                  <div style={{
                                    height: '100%', borderRadius: 3,
                                    width: `${progress.pct}%`,
                                    background: complete ? 'var(--c-success)' : 'var(--c-accent)',
                                    transition: 'width 0.3s',
                                  }} />
                                </div>
                                <span style={{ fontSize: 11.5, fontWeight: 600, color: complete ? 'var(--c-success)' : 'var(--c-text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
                                  {progress.pct}%
                                </span>
                              </div>
                            </div>
                          )
                        })()}
                      </Td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      ) : (
        <KanbanBoard
          filters={{ search: search.trim() || undefined, sku: skuFilter.trim() || undefined, client_id: clientId || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined }}
          onNavigate={(id) => navigate(`/inventory/shipments/${id}`)}
          reloadTick={reloadTick}
        />
      )}
    </ListPage>
  )
}

const KANBAN_PAGE = 20

type KanbanFilters = {
  search?: string
  sku?: string
  client_id?: string
  date_from?: string
  date_to?: string
}

function KanbanBoard({ filters, onNavigate, reloadTick }: {
  filters: KanbanFilters
  onNavigate: (id: string) => void
  reloadTick?: number
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, alignItems: 'start' }}>
      {KANBAN_COLS.map((col) => (
        <KanbanColumn key={col.status} col={col} filters={filters} onNavigate={onNavigate} reloadTick={reloadTick} />
      ))}
    </div>
  )
}

function KanbanColumn({ col, filters, onNavigate, reloadTick }: {
  col: typeof KANBAN_COLS[number]
  filters: KanbanFilters
  onNavigate: (id: string) => void
  reloadTick?: number
}) {
  const [items, setItems] = useState<ShipmentListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const filterKey = `${filters.search}|${filters.sku}|${filters.client_id}|${filters.date_from}|${filters.date_to}|${reloadTick ?? 0}`
  const prevFilterKey = useRef(filterKey)

  useEffect(() => {
    const ctrl = new AbortController()
    const isReset = prevFilterKey.current !== filterKey
    prevFilterKey.current = filterKey
    const activePage = isReset ? 1 : page
    if (isReset) {
      setPage(1)
      setItems([])
    }
    if (activePage === 1) setLoading(true); else setLoadingMore(true)
    listShipments({
      page: activePage,
      limit: KANBAN_PAGE,
      status: col.status,
      ...filters,
    }, ctrl.signal)
      .then((res) => {
        if (ctrl.signal.aborted) return
        setTotal(res.total)
        setItems((prev) => activePage === 1 ? res.items : [...prev, ...res.items])
      })
      .catch(() => {})
      .finally(() => {
        if (ctrl.signal.aborted) return
        setLoading(false)
        setLoadingMore(false)
      })
    return () => ctrl.abort()
  }, [page, filterKey, col.status])

  const hasMore = items.length < total

  return (
    <div style={{ background: 'var(--c-bg-sunken)', borderRadius: 10, padding: 10, minHeight: 200 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px 10px', gap: 8 }}>
        <Badge tone={col.tone} dot>{col.label}</Badge>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
          {loading ? '…' : total}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
            <div style={{ width: 20, height: 20, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: '16px 6px', fontSize: 12, color: 'var(--c-text-faint)', textAlign: 'center' }}>Нет документов</div>
        ) : (
          items.map((item) => {
            const overdue = isShipmentOverdue(item)
            return (
              <div
                key={item.id}
                className="card"
                style={{
                  padding: 10, cursor: 'pointer',
                  ...(overdue ? { borderLeft: '2px solid var(--c-danger)' } : {}),
                }}
                onClick={() => onNavigate(item.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--c-text-muted)' }}>{item.doc_number}</span>
                  {overdue && <Icon name="alert" size={12} style={{ color: 'var(--c-danger)' }} />}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: overdue ? 'var(--c-danger)' : 'var(--c-text-faint)', fontWeight: overdue ? 500 : 400 }}>
                    {fmtDate(item.ship_date)}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{item.client_name ?? '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 8 }}>{item.destination ?? '—'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{item.total_qty} шт</span>
                  <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>·</span>
                  <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{item.sku_count} SKU</span>
                </div>
              </div>
            )
          })
        )}
        {hasMore && (
          <button
            className="btn ghost sm"
            style={{ width: '100%', justifyContent: 'center', color: 'var(--c-text-subtle)', fontSize: 12 }}
            disabled={loadingMore}
            onClick={() => setPage((p) => p + 1)}
          >
            {loadingMore ? '…' : `Ещё ${total - items.length}`}
          </button>
        )}
      </div>
    </div>
  )
}
