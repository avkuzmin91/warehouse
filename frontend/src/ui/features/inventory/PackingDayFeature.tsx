import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listShipments } from '../../../api/shipmentsApi'
import type { ShipmentListItem } from '../../../api/shipmentsApi'
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
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'

const PAGE_SIZE = 25

const today = () => new Date().toISOString().slice(0, 10)

function packProgress(item: ShipmentListItem) {
  const totalQty = item.total_qty || 0
  const packedQty = item.total_packed_qty ?? 0
  const pct = totalQty > 0 ? Math.min(100, Math.floor((packedQty / totalQty) * 100)) : 0
  return { pct, packedQty, totalQty }
}

export function PackingDayFeature() {
  const navigate = useNavigate()
  const todayStr = today()

  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', todayStr)
  const [dateTo, setDateTo] = useFilterParam('to', todayStr)
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const [reloadTick, setReloadTick] = useState(0)

  const { clients } = useLookups()

  const { data, loading } = useApi(
    (signal) => listShipments({
      page, limit: PAGE_SIZE,
      status: 'packing',
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, signal),
    [page, search, clientId, dateFrom, dateTo, reloadTick],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const isToday = dateFrom === todayStr && dateTo === todayStr

  return (
    <ListPage
      title="Упаковка"
      subtitle={isToday ? `На сегодня: ${total}` : `Найдено: ${total}`}
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
            onClear={() => setMany({ from: todayStr, to: todayStr })}
          />
          {!isToday && (
            <button className="btn ghost sm" onClick={() => setMany({ from: todayStr, to: todayStr })}>
              <Icon name="calendar" size={12} />Сегодня
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
      <Table>
        <thead>
          <tr>
            <th style={{ width: 120 }}>Номер</th>
            <th>Клиент</th>
            <th>Назначение</th>
            <th style={{ width: 110 }}>Дата отгрузки</th>
            <th style={{ textAlign: 'right', width: 60 }}>SKU</th>
            <th style={{ textAlign: 'right', width: 80 }}>План</th>
            <th style={{ textAlign: 'right', width: 90 }}>Упаковано</th>
            <th style={{ width: 170 }}>Прогресс</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={8} />
          ) : items.length === 0 ? (
            <tr><td colSpan={8}>
              <EmptyState
                title={isToday ? 'На сегодня отгрузок в упаковке нет' : 'Отгрузок в упаковке не найдено'}
                sub="Здесь появляются отгрузки в статусе «В плане»"
              />
            </td></tr>
          ) : (
            items.map((item) => {
              const progress = packProgress(item)
              const complete = progress.pct >= 100
              return (
                <tr
                  key={item.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/inventory/shipments/${item.id}`)}
                >
                  <Td className="mono" style={{ fontWeight: 500 }}>{item.doc_number}</Td>
                  <Td>{item.client_name ?? '—'}</Td>
                  <Td className="t-sub">{item.destination ?? '—'}</Td>
                  <Td className="mono">{fmtDate(item.ship_date)}</Td>
                  <Td className="num">{item.sku_count}</Td>
                  <Td className="num">{item.total_qty.toLocaleString('ru-RU')}</Td>
                  <Td className="num" style={complete ? { color: 'var(--c-success)', fontWeight: 600 } : {}}>
                    {progress.packedQty.toLocaleString('ru-RU')}
                  </Td>
                  <Td>
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
