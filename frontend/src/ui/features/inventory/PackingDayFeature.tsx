import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isShipmentOverdue, listShipments, SHIPMENT_STATUS_TONES } from '../../../api/shipmentsApi'
import type { ShipmentListItem } from '../../../api/shipmentsApi'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtDateShort as fmtDate } from '../../../utils/format'
import { useLookups } from '../../../hooks/useLookups'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'
import { canEditShipments } from '../../../utils/access'
import { PackingProductivityView } from './PackingProductivityView'
import { PackingTabs } from './PackingTabs'
import { ShipmentPriorityControl } from './ShipmentPriorityControl'

const PAGE_SIZE = 25

const today = () => new Date().toISOString().slice(0, 10)

function packProgress(item: ShipmentListItem) {
  const totalQty = item.total_qty || 0
  const packedQty = item.total_packed_qty ?? 0
  const pct = totalQty > 0 ? Math.min(100, Math.floor((packedQty / totalQty) * 100)) : 0
  return { pct, packedQty, totalQty }
}

export function PackingDayFeature() {
  const [tab] = useFilterParam('tab', 'queue')
  if (tab === 'productivity') return <PackingProductivityView />
  return <PackingQueueView />
}

function PackingQueueView() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const canEdit = canEditShipments(user)
  const todayStr = today()

  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  // Рабочая очередь: всё, что должно быть упаковано к сегодняшнему дню (без нижней границы).
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', todayStr)
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const [reloadTick, setReloadTick] = useState(0)
  const [flashId, setFlashId] = useState<string | null>(null)

  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 2500)
    return () => clearTimeout(t)
  }, [flashId])

  const { clients } = useLookups()

  const { data, loading } = useApi(
    (signal) => listShipments({
      page, limit: PAGE_SIZE,
      status: ['packing', 'on_packing'],
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, signal),
    [page, search, clientId, dateFrom, dateTo, reloadTick],
  )

  const { data: overdueData } = useApi(
    (signal) => listShipments({
      page: 1, limit: 1, overdue: true,
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, signal),
    [search, clientId, dateFrom, dateTo, reloadTick],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const overdueTotal = overdueData?.total ?? 0
  const isDefault = !dateFrom && dateTo === todayStr

  return (
    <ListPage
      title="Упаковка"
      subtitle={isDefault
        ? `В работе: ${total}${overdueTotal > 0 ? `, из них просрочено: ${overdueTotal}` : ''}`
        : `Найдено: ${total}`}
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
            onClear={() => setMany({ from: null, to: null })}
          />
          {!isDefault && (
            <button className="btn ghost sm" onClick={() => setMany({ from: null, to: null })}>
              <Icon name="x" size={12} />Сбросить период
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
      <PackingTabs active="queue" />
      <Table>
        <thead>
          <tr>
            <th style={{ width: 120 }}>Номер</th>
            <th style={{ width: 130 }}>Приор.</th>
            <th>Клиент</th>
            <th>Назначение</th>
            <th style={{ width: 110 }}>Дата отгрузки</th>
            <th style={{ width: 120 }}>Статус</th>
            <th style={{ textAlign: 'right', width: 60 }}>SKU</th>
            <th style={{ textAlign: 'right', width: 80 }}>План</th>
            <th style={{ textAlign: 'right', width: 90 }}>Упаковано</th>
            <th style={{ width: 170 }}>Прогресс</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={10} />
          ) : items.length === 0 ? (
            <tr><td colSpan={10}>
              <EmptyState
                title={isDefault ? 'Отгрузок в упаковке нет' : 'Отгрузок в упаковке не найдено'}
                sub="Здесь появляются отгрузки в статусах «В плане» и «На упаковке»"
              />
            </td></tr>
          ) : (
            items.map((item) => {
              const inWork = item.status === 'on_packing'
              const overdue = isShipmentOverdue(item)
              const progress = packProgress(item)
              const complete = progress.pct >= 100
              return (
                <tr
                  key={item.id}
                  style={{
                    cursor: 'pointer',
                    transition: 'background 0.6s',
                    ...(overdue ? {
                      background: 'color-mix(in oklab, var(--c-danger) 5%, transparent)',
                      borderLeft: '2px solid var(--c-danger)',
                    } : {}),
                    ...(item.id === flashId ? {
                      background: 'color-mix(in oklab, var(--c-accent) 12%, transparent)',
                    } : {}),
                  }}
                  onClick={() => navigate(`/inventory/shipments/${item.id}`)}
                >
                  <Td className="mono" style={{ fontWeight: 500 }}>
                    {item.doc_number}
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
                      onSaved={() => { setFlashId(item.id); setReloadTick((t) => t + 1) }}
                    />
                  </Td>
                  <Td>{item.client_name ?? '—'}</Td>
                  <Td className="t-sub">{item.destination ?? '—'}</Td>
                  <Td className="mono" style={overdue ? { color: 'var(--c-danger)', fontWeight: 500 } : {}}>
                    {fmtDate(item.ship_date)}
                  </Td>
                  <Td>
                    <Badge tone={SHIPMENT_STATUS_TONES[item.status] as BadgeTone} dot>
                      {item.status_label}
                    </Badge>
                  </Td>
                  <Td className="num">{item.sku_count}</Td>
                  <Td className="num">{item.total_qty.toLocaleString('ru-RU')}</Td>
                  <Td className="num" style={complete ? { color: 'var(--c-success)', fontWeight: 600 } : {}}>
                    {inWork ? progress.packedQty.toLocaleString('ru-RU') : '—'}
                  </Td>
                  <Td>
                    {inWork ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
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
                    ) : (
                      <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
                    )}
                  </Td>
                </tr>
              )
            })
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </ListPage>
  )
}
