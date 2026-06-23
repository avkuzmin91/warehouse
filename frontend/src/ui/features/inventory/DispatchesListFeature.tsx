import { useMemo, useState, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  listDispatches,
  DISPATCH_STATUS_LABELS,
  DISPATCH_STATUS_ORDER,
  DISPATCH_STATUS_TONES,
} from '../../../api/dispatchApi'
import type { DispatchCargoType, DispatchListItem, DispatchStatus } from '../../../api/dispatchApi'
import { DispatchPriorityControl } from './DispatchPriorityControl'
import { DispatchLinesView } from './DispatchLinesView'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { Dropdown } from '../../primitives/Dropdown'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtDateShort as fmtDate, dayGroupKey, dayGroupLabel } from '../../../utils/format'
import { useApi } from '../../../hooks/useApi'
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

function dispatchProgress(item: DispatchListItem) {
  const total = item.total_qty || 0
  const shipped = item.total_shipped_qty ?? 0
  const pct = total > 0 ? Math.min(100, Math.floor(shipped / total * 100)) : 0
  return { pct, shipped, total }
}

/** Группировка строк по дате отгрузки с сохранением порядка выдачи backend. */
function groupByDay(items: DispatchListItem[]) {
  const groups: { key: string; label: string; rows: DispatchListItem[] }[] = []
  for (const item of items) {
    const key = dayGroupKey(item.ship_date)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(item)
    else groups.push({ key, label: dayGroupLabel(item.ship_date), rows: [item] })
  }
  return groups
}

export function DispatchesListFeature() {
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

  const [reloadTick, setReloadTick] = useState(0)

  const { clients } = useLookups()

  const statusParam = useMemo<DispatchStatus | undefined>(
    () => (statusFilter ? (statusFilter as DispatchStatus) : undefined),
    [statusFilter],
  )
  const cargoParam: DispatchCargoType | undefined =
    cargoFilter === 'good' || cargoFilter === 'defect' ? cargoFilter : undefined

  const { data, loading } = useApi(
    (signal) => mode !== 'docs'
      ? Promise.resolve({ items: [], total: 0, page, limit: PAGE_SIZE })
      : listDispatches({
          page, limit: PAGE_SIZE,
          search: search.trim() || undefined,
          sku: skuFilter.trim() || undefined,
          client_id: clientId || undefined,
          status: statusParam,
          cargo_type: cargoParam,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        }, signal),
    [mode, page, search, skuFilter, clientId, statusParam, cargoParam, dateFrom, dateTo, reloadTick],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0

  async function handleAdvance(e: React.MouseEvent, item: DispatchListItem) {
    e.stopPropagation()
    setAdvancingId(item.id)
    try {
      await advanceDispatch(item.id)
      setReloadTick((t) => t + 1)
    } finally {
      setAdvancingId(null)
    }
  }

  return (
    <ListPage
      title="Отгрузки"
      subtitle={mode === 'docs' ? `Всего: ${total}` : undefined}
      actions={
        canCreate ? (
          <Dropdown
            trigger={
              <button className="btn primary">
                <Icon name="plus" size={14} />Создать отгрузку<Icon name="chevDown" size={12} />
              </button>
            }
            items={[
              { label: 'Отгрузка товара', icon: <Icon name="box" size={14} />, onClick: () => navigate('/inventory/dispatches/new') },
              { label: 'Отгрузка брака', icon: <Icon name="alert" size={14} />, onClick: () => navigate('/inventory/dispatches/new?cargo=defect') },
            ]}
          />
        ) : undefined
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
              ...([...DISPATCH_STATUS_ORDER, 'cancelled'] as DispatchStatus[])
                .map((s) => ({ value: s, label: DISPATCH_STATUS_LABELS[s] })),
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
        <DispatchLinesView
          search={search}
          sku={skuFilter}
          clientId={clientId}
          status={statusParam}
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
            <th style={{ width: 130 }}>Номер</th>
            <th style={{ width: 130 }}>Приор.</th>
            <th>Клиент</th>
            <th style={{ width: 110 }}>Дата отгрузки</th>
            <th style={{ textAlign: 'right', width: 80 }}>План</th>
            <th style={{ textAlign: 'right', width: 90 }}>Отгружено</th>
            <th style={{ width: 150 }}>Статус</th>
            <th style={{ width: 150 }}>Выполнение</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={8} />
          ) : items.length === 0 ? (
            <tr><td colSpan={8}>
              <EmptyState
                title="Отгрузок нет"
                sub={!statusFilter ? 'Создайте первую отгрузку' : undefined}
              />
            </td></tr>
          ) : (
            groupByDay(items).map((g) => (
              <Fragment key={g.key}>
                <tr className="list-day-row">
                  <td colSpan={8}>
                    <div className="list-day-head">
                      <span className="list-day-title"><Icon name="calendar" size={14} />{g.label}</span>
                      <span className="list-day-counts"><span className="t-sub">{g.rows.length}</span></span>
                    </div>
                  </td>
                </tr>
                {g.rows.map((item) => {
                  const progress = dispatchProgress(item)
                  const complete = progress.pct >= 100
                  const showProgress = item.status === 'partially_shipped' || item.status === 'shipped'
                  return (
                    <tr
                      key={item.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/inventory/dispatches/${item.id}`)}
                    >
                      <Td className="mono" style={{ fontWeight: 500 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {item.doc_number}
                          {item.cargo_type === 'defect' && <Badge tone="warning">Брак</Badge>}
                        </span>
                      </Td>
                      <Td>
                        <DispatchPriorityControl
                          dispatch={item}
                          canEdit={canEdit}
                          onSaved={() => setReloadTick((t) => t + 1)}
                        />
                      </Td>
                      <Td>{item.client_name ?? '—'}</Td>
                      <Td className="mono">{fmtDate(item.ship_date)}</Td>
                      <Td className="num">{item.total_qty.toLocaleString('ru-RU')}</Td>
                      <Td className="num">{(item.total_shipped_qty ?? 0).toLocaleString('ru-RU')}</Td>
                      <Td>
                        <Badge tone={DISPATCH_STATUS_TONES[item.status] as BadgeTone} dot>
                          {item.status_label}
                        </Badge>
                      </Td>
                      <Td>
                        {showProgress ? (
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
                        ) : (
                          <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
                        )}
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
