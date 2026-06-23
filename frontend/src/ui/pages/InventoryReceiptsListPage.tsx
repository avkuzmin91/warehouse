import { useState, useEffect, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getReceipts,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STATUS_ORDER,
  receiptStatusTone,
  isReceiptOverdue,
} from '../../api/receiptsApi'
import type { ReceiptListItem, ReceiptStatus } from '../../api/receiptsApi'
import { ReceiptLinesView } from '../features/inventory/ReceiptLinesView'
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
import { fmtDate, dayGroupKey, dayGroupLabel } from '../../utils/format'
import { useLookups } from '../../hooks/useLookups'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { canCreateDocuments } from '../../utils/access'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../hooks/useFilterParams'

const PAGE_SIZE = 25

type ModeId = 'docs' | 'items'

const MODE_TABS: { id: ModeId; label: string }[] = [
  { id: 'docs',  label: 'По документам' },
  { id: 'items', label: 'По товарам' },
]

function receiptDayDate(item: ReceiptListItem): string | null {
  return item.actual_arrival_date ?? item.arrival_date
}

/** Группировка строк списка по дню прибытия с сохранением порядка выдачи backend. */
function groupReceiptsByDay(items: ReceiptListItem[]) {
  const groups: { key: string; label: string; rows: ReceiptListItem[] }[] = []
  for (const item of items) {
    const key = dayGroupKey(receiptDayDate(item))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(item)
    else groups.push({ key, label: dayGroupLabel(receiptDayDate(item)), rows: [item] })
  }
  return groups
}

export function InventoryReceiptsListPage() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()
  const canCreate = canCreateDocuments(user)

  const [mode, setMode] = useFilterParam('mode', 'docs')
  const [search, setSearch] = useFilterParam('search', '')
  const [skuFilter, setSkuFilter] = useFilterParam('sku', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [statusFilter, setStatusFilter] = useFilterParam('status', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const [items, setItems] = useState<ReceiptListItem[]>([])

  const { clients } = useLookups()

  const isOverdueFilter = statusFilter === 'overdue'
  const statusParam: ReceiptStatus | undefined =
    !statusFilter || isOverdueFilter ? undefined : (statusFilter as ReceiptStatus)
  const overdueParam = isOverdueFilter || undefined

  useEffect(() => {
    if (mode !== 'docs') {
      setInitialLoading(false)
      return
    }
    const ctrl = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    setLoading(true)
    setLoadError(null)
    getReceipts({
      page,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      sku: skuFilter.trim() || undefined,
      client_id: clientId || undefined,
      status: statusParam,
      overdue: overdueParam,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, ctrl.signal).then((res) => {
      if (ctrl.signal.aborted) return
      setItems(res.items)
      setTotal(res.total)
      setLoadError(null)
    }).catch((e) => {
      if (ctrl.signal.aborted) return
      console.error('[receipts] load failed:', e)
      setLoadError(e instanceof Error ? e.message : String(e))
      if (initialLoading) {
        retryTimer = setTimeout(() => setRetryTick((t) => t + 1), 400)
      }
    }).finally(() => {
      if (ctrl.signal.aborted) return
      setLoading(false)
      setInitialLoading(false)
    })
    return () => {
      ctrl.abort()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [mode, page, search, skuFilter, clientId, statusParam, overdueParam, dateFrom, dateTo, retryTick, initialLoading])

  const STATUS_OPTIONS = [
    { value: '', label: 'Все статусы' },
    { value: 'overdue', label: 'Просрочка' },
    ...([...RECEIPT_STATUS_ORDER.filter((s) => s !== 'draft'), 'partially_received', 'cancelled'] as ReceiptStatus[])
      .map((s) => ({ value: s, label: RECEIPT_STATUS_LABELS[s] })),
  ]

  if (initialLoading) {
    return (
      <ListPage title="Поступления">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16 }}>
          <div style={{ width: 32, height: 32, border: '2.5px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'var(--c-text-subtle)' }}>Загрузка поступлений…</span>
        </div>
      </ListPage>
    )
  }

  return (
    <ListPage
      title="Поступления"
      subtitle={mode === 'docs' ? `Всего: ${total}` : undefined}
      actions={
        canCreate && (
          <button className="btn primary" onClick={() => navigate('/inventory/receipts/new')}>
            <Icon name="plus" size={14} />Новое поступление
          </button>
        )
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Номер или клиент…"
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
            options={STATUS_OPTIONS}
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
            onClick={() => setRetryTick((t) => t + 1)}
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
        <ReceiptLinesView
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
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th style={{ width: 150 }}>Номер</th>
                <th>Клиент</th>
                <th style={{ width: 120 }}>Дата прибытия</th>
                <th style={{ width: 100, textAlign: 'right' }}>План</th>
                <th style={{ width: 100, textAlign: 'right' }}>Факт</th>
                <th style={{ width: 130 }}>Статус</th>
                <th style={{ width: 130 }}>Рейсы</th>
                <th style={{ width: 160 }}>Принято</th>
                <th style={{ width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={10} />
              ) : loadError ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title="Не удалось загрузить документы"
                      sub={loadError}
                      action={
                        <button className="btn primary" onClick={() => setRetryTick((t) => t + 1)}>
                          <Icon name="check" size={14} />Повторить
                        </button>
                      }
                    />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title="Документов нет"
                      sub={isOverdueFilter ? 'Просроченных документов нет' : 'Создайте первый документ поступления'}
                      action={
                        canCreate && !statusFilter ? (
                          <button className="btn primary" onClick={() => navigate('/inventory/receipts/new')}>
                            <Icon name="plus" size={14} />Новое поступление
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                groupReceiptsByDay(items).map((g) => (
                  <Fragment key={g.key}>
                    <tr className="list-day-row">
                      <td colSpan={10}>
                        <div className="list-day-head">
                          <span className="list-day-title"><Icon name="calendar" size={14} />{g.label}</span>
                          <span className="list-day-counts"><span className="t-sub">{g.rows.length}</span></span>
                        </div>
                      </td>
                    </tr>
                    {g.rows.map((item) => {
                  const overdue = isReceiptOverdue(item)
                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/inventory/receipts/${item.id}`)}
                      style={overdue ? {
                        background: 'color-mix(in oklab, var(--c-danger) 5%, transparent)',
                        borderLeft: '2px solid var(--c-danger)',
                      } : {}}
                    >
                      <Td style={{ paddingLeft: overdue ? 6 : 8 }}>
                        {overdue && (
                          <Icon name="alert" size={14} style={{ color: 'var(--c-danger)' }} title="Просрочен" />
                        )}
                      </Td>
                      <Td>
                        <span className="mono" style={{ fontWeight: 500 }}>{item.doc_number}</span>
                        {overdue && (
                          <div style={{ fontSize: 11, color: 'var(--c-danger)', fontWeight: 500, marginTop: 2 }}>
                            просрочен
                          </div>
                        )}
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 450 }}>{item.client_name ?? '—'}</div>
                        {item.supplier_name && (
                          <div className="t-sub">{item.supplier_name}</div>
                        )}
                      </Td>
                      <Td>
                        <span style={overdue ? { color: 'var(--c-danger)', fontWeight: 500 } : { color: 'var(--c-text-subtle)' }}>
                          {fmtDate(item.actual_arrival_date ?? item.arrival_date)}
                        </span>
                      </Td>
                      <Td className="num">{item.total_planned.toLocaleString('ru-RU')}</Td>
                      <Td className="num">{item.total_accepted_qty.toLocaleString('ru-RU')}</Td>
                      <Td>
                        <Badge tone={receiptStatusTone(item.status) as BadgeTone} dot>
                          {RECEIPT_STATUS_LABELS[item.status]}
                        </Badge>
                      </Td>
                      <Td>
                        {!item.trips?.length ? (
                          <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {item.trips.map((t) => (
                              <button
                                key={t.id}
                                className="mono"
                                style={{ background: 'var(--c-bg-sunken)', border: '1px solid var(--c-border)', borderRadius: 5, padding: '1px 6px', fontSize: 11.5, color: 'var(--c-text-muted)', cursor: 'pointer' }}
                                onClick={(e) => { e.stopPropagation(); navigate(`/logistics/trips/${t.id}`) }}
                              >
                                {t.number}
                              </button>
                            ))}
                          </div>
                        )}
                      </Td>
                      <Td>
                        {(() => {
                          const pct = item.total_planned > 0 ? Math.min(100, Math.floor(item.total_accepted_qty / item.total_planned * 100)) : 0
                          const isActive = item.status === 'on_review' || item.status === 'partially_received' || item.status === 'done'
                          if (!isActive) return <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
                          return (
                            <div style={{ minWidth: 120 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--c-border-strong)', overflow: 'hidden' }}>
                                  <div style={{
                                    height: '100%', borderRadius: 3,
                                    width: `${pct}%`,
                                    background: pct === 100 ? 'var(--c-success)' : 'var(--c-accent)',
                                    transition: 'width 0.3s',
                                  }} />
                                </div>
                                <span style={{ fontSize: 11.5, fontWeight: 600, color: pct === 100 ? 'var(--c-success)' : 'var(--c-text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
                                  {pct}%
                                </span>
                              </div>
                            </div>
                          )
                        })()}
                      </Td>
                      <Td>
                        <Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} />
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
