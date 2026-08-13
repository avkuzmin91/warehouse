import { useState, useEffect, useMemo, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listShipments,
  isShipmentOverdue,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
  SHIPMENT_STATUS_ORDER,
} from '../../../api/shipmentsApi'
import type { ShipmentCargoType, ShipmentListItem, ShipmentStatus } from '../../../api/shipmentsApi'
import { ShipmentLinesView } from './ShipmentLinesView'
import { ShipmentPriorityControl } from './ShipmentPriorityControl'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtDateShort as fmtDate, dayGroupKey, dayGroupLabel } from '../../../utils/format'
import { useLookups } from '../../../hooks/useLookups'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'
import { canCreateDocuments, canEditShipments } from '../../../utils/access'

const PAGE_SIZE = 25

type ModeId = 'docs' | 'items'

const MODE_TABS: { id: ModeId; label: string }[] = [
  { id: 'docs',  label: 'По документам' },
  { id: 'items', label: 'По товарам' },
]

function shipmentProgress(item: ShipmentListItem) {
  const totalQty = item.total_qty || 0
  const packedQty = shipmentPackedQty(item)
  const pct = totalQty > 0
    ? Math.min(100, Math.floor(packedQty / totalQty * 100))
    : 0
  const linesCount = item.sku_count || 0
  const qtyReady = totalQty > 0 && packedQty >= totalQty
  const zoneReady = item.cargo_type !== 'good' || (linesCount > 0 && (item.lines_with_zone ?? 0) === linesCount)
  return { pct, packedQty, totalQty, qtyReady, zoneReady }
}

function shipmentPackedQty(item: ShipmentListItem) {
  return item.total_packed_qty ?? 0
}

/** Группировка строк списка по дате отгрузки с сохранением порядка выдачи backend. */
function groupShipmentsByDay(items: ShipmentListItem[]) {
  const groups: { key: string; label: string; rows: ShipmentListItem[] }[] = []
  for (const item of items) {
    const key = dayGroupKey(item.ship_date)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(item)
    else groups.push({ key, label: dayGroupLabel(item.ship_date), rows: [item] })
  }
  return groups
}

export function PackingTasksFeature() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const canEdit = canEditShipments(user)
  const canCreate = canCreateDocuments(user)

  const [mode, setMode] = useFilterParam('mode', 'docs')
  const [search, setSearch] = useFilterParam('search', '')
  const [skuFilter, setSkuFilter] = useFilterParam('sku', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [statusFilter, setStatusFilter] = useFilterParam('status', '')
  const [cargoFilter, setCargoFilter] = useFilterParam('cargo', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

  // Debounce поиска: инпут меняется мгновенно, URL и запрос — после паузы.
  // Sync-эффект подхватывает внешнюю смену URL («Сбросить», «Назад»).
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const [skuInput, setSkuInput] = useState(skuFilter)
  useEffect(() => { setSkuInput(skuFilter) }, [skuFilter])
  useEffect(() => {
    if (skuInput === skuFilter) return
    const timer = setTimeout(() => setSkuFilter(skuInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuInput, skuFilter])

  const [items, setItems] = useState<ShipmentListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)

  const { clients } = useLookups()

  const isOverdueFilter = statusFilter === 'overdue'
  const statusParam = useMemo<ShipmentStatus | ShipmentStatus[] | undefined>(
    () =>
      !statusFilter || statusFilter === 'overdue'
        ? undefined
        : statusFilter.includes(',')
          ? (statusFilter.split(',') as ShipmentStatus[])
          : (statusFilter as ShipmentStatus),
    [statusFilter],
  )
  const overdueParam = isOverdueFilter || undefined
  const cargoParam: ShipmentCargoType | undefined =
    cargoFilter === 'good' || cargoFilter === 'defect' ? cargoFilter : undefined

  useEffect(() => {
    if (mode !== 'docs') {
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
      cargo_type: cargoParam,
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
  }, [mode, page, search, skuFilter, clientId, statusParam, overdueParam, cargoParam, dateFrom, dateTo, reloadTick])

  function handlePrioritySaved(id: string, priorityRank: number | null) {
    setItems((prev) => prev.map((item) => (
      item.id === id ? { ...item, priority_rank: priorityRank } : item
    )))
    setReloadTick((t) => t + 1)
  }

  if (initialLoading) {
    return (
      <ListPage title="Упаковка">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
          <div style={{ width: 28, height: 28, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      </ListPage>
    )
  }

  return (
    <ListPage
      title="Упаковка"
      subtitle={mode === 'docs' ? `Всего: ${total}` : undefined}
      actions={
        <>
          <button className="btn ghost" onClick={() => navigate('/inventory/packing/productivity')}>
            <Icon name="chart" size={14} />Производительность
          </button>
          {canCreate && (
            <button className="btn primary" onClick={() => navigate('/inventory/shipments/new')}>
              <Icon name="plus" size={14} />Новая задача
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
              style={{ paddingLeft: 28, width: 220, paddingRight: searchInput ? 26 : undefined }}
              placeholder="Номер, клиент, назначение…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearchInput(''); setSearch('') }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="tag" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 190, paddingRight: skuInput ? 26 : undefined }}
              placeholder="SKU или название…"
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
            />
            {skuInput && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSkuInput(''); setSkuFilter('') }}
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
            label="Тип груза"
            value={cargoFilter}
            options={[
              { value: '', label: 'Все типы' },
              { value: 'good', label: 'Годный' },
              { value: 'defect', label: 'Брак' },
            ]}
            onChange={(v) => setCargoFilter(v)}
          />
          <FilterSelect
            label="Статус"
            value={statusFilter}
            options={[
              { value: '', label: 'Все статусы' },
              { value: 'overdue', label: 'Просрочка' },
              ...([...SHIPMENT_STATUS_ORDER, 'cancelled'] as ShipmentStatus[])
                .map((s) => ({ value: s, label: SHIPMENT_STATUS_LABELS[s] })),
            ]}
            onChange={(v) => setStatusFilter(v)}
          />
          {(clientId || skuFilter || dateFrom || dateTo || statusFilter || cargoFilter) && (
            <button className="btn ghost sm" onClick={() => setMany({ client: '', sku: '', from: '', to: '', status: '', cargo: '' })}>
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
          cargoType={cargoParam}
          dateFrom={dateFrom}
          dateTo={dateTo}
          page={page}
          onPage={setPage}
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th style={{ width: 120 }}>Номер</th>
                <th style={{ width: 130 }}>Приор.</th>
                <th>Клиент</th>
                <th style={{ width: 110 }}>Дата упаковки</th>
                <th style={{ textAlign: 'right', width: 80 }}>План</th>
                <th style={{ textAlign: 'right', width: 80 }}>Факт</th>
                <th style={{ width: 130 }}>Статус</th>
                <th style={{ width: 150 }}>Выполнение</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={9} />
              ) : items.length === 0 ? (
                <tr><td colSpan={9}>
                  <EmptyState
                    title={isOverdueFilter ? 'Просроченных задач нет' : 'Задач упаковки нет'}
                    sub={!statusFilter ? 'Создайте первую задачу' : undefined}
                  />
                </td></tr>
              ) : (
                groupShipmentsByDay(items).map((g) => (
                  <Fragment key={g.key}>
                    <tr className="list-day-row">
                      <td colSpan={9}>
                        <div className="list-day-head">
                          <span className="list-day-title"><Icon name="calendar" size={14} />{g.label}</span>
                          <span className="list-day-counts"><span className="t-sub">{g.rows.length}</span></span>
                        </div>
                      </td>
                    </tr>
                    {g.rows.map((item) => {
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {item.doc_number}
                          {item.cargo_type === 'defect' && <Badge tone="warning">Брак</Badge>}
                        </span>
                        {overdue && (
                          <div style={{ fontSize: 11, color: 'var(--c-danger)', fontWeight: 500, marginTop: 2 }}>
                            просрочена
                          </div>
                        )}
                      </Td>
                      <Td>
                        <ShipmentPriorityControl
                          shipment={item}
                          canEdit={canEdit}
                          onSaved={(priorityRank) => handlePrioritySaved(item.id, priorityRank)}
                        />
                      </Td>
                      <Td>{item.client_name ?? '—'}</Td>
                      <Td className="mono" style={overdue ? { color: 'var(--c-danger)', fontWeight: 500 } : {}}>
                        {fmtDate(item.ship_date)}
                      </Td>
                      <Td className="num">{item.total_qty.toLocaleString('ru-RU')}</Td>
                      <Td className="num">{shipmentPackedQty(item).toLocaleString('ru-RU')}</Td>
                      <Td>
                        <Badge tone={SHIPMENT_STATUS_TONES[item.status] as BadgeTone} dot>
                          {item.status_label}
                        </Badge>
                      </Td>
                      <Td>
                        {(() => {
                          const isActive = !['draft', 'cancelled'].includes(item.status)
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
                    })}
                  </Fragment>
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      )}
    </ListPage>
  )
}
