import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  getReceipts,
  getReceiptsSummary,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STATUS_ORDER,
  receiptStatusTone,
  isReceiptOverdue,
} from '../../api/receiptsApi'
import type { ReceiptListItem, ReceiptStatus, ReceiptsSummary } from '../../api/receiptsApi'
import { getInventoryClients } from '../../api/inventoryLookupsApi'
import type { DictionaryItem } from '../../api/domainTypes'
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
import { fmtDate } from '../../utils/format'
import { useApi } from '../../hooks/useApi'

const PAGE_SIZE = 25

type TabId = 'all' | 'active' | 'overdue' | 'done' | 'drafts'

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'В работе' },
  { id: 'overdue', label: 'Просрочка' },
  { id: 'done', label: 'Завершённые' },
  { id: 'drafts', label: 'В плане' },
]

const TAB_STATUS: Partial<Record<TabId, ReceiptStatus>> = {
  active: 'on_review',
  done: 'done',
  drafts: 'planned',
}

const KANBAN_COLS: { status: ReceiptStatus; label: string; tone: BadgeTone }[] = [
  { status: 'planned',   label: 'В плане',      tone: 'info' },
  { status: 'on_review', label: 'На проверке',  tone: 'warning' },
  { status: 'done',      label: 'Завершён',      tone: 'success' },
]

export function InventoryReceiptsListPage() {
  const navigate = useNavigate()
  const { key: locationKey } = useLocation()
  const [tab, setTab] = useState<TabId>('all')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReceiptStatus | ''>('')
  const [items, setItems] = useState<ReceiptListItem[]>([])
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [kanbanItems, setKanbanItems] = useState<ReceiptListItem[]>([])

  const { data: clientsData } = useApi((signal) => getInventoryClients(signal), [])
  const clients: DictionaryItem[] = clientsData ?? []

  const { data: summaryData } = useApi(
    (signal) => getReceiptsSummary({
      client_id: clientId || undefined,
      search: search.trim() || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, signal),
    [clientId, search, dateFrom, dateTo, locationKey],
  )
  const summary: ReceiptsSummary = summaryData ?? { all: 0, active: 0, done: 0, drafts: 0, overdue: 0 }

  useEffect(() => {
    if (view !== 'table') return
    const ctrl = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    setLoading(true)
    setLoadError(null)
    const effectiveStatus = statusFilter || TAB_STATUS[tab]
    getReceipts({
      page,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      status: effectiveStatus,
      overdue: tab === 'overdue' && !statusFilter ? true : undefined,
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
  }, [view, page, search, clientId, statusFilter, tab, dateFrom, dateTo, locationKey, retryTick, initialLoading])

  useEffect(() => {
    if (view !== 'kanban') return
    const ctrl = new AbortController()
    getReceipts({
      page: 1,
      limit: 200,
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, ctrl.signal).then((res) => setKanbanItems(res.items)).catch(() => {})
    return () => ctrl.abort()
  }, [view, search, clientId, dateFrom, dateTo])

  // When tab changes reset page and clear manual status chip
  function handleTabChange(t: TabId) {
    setTab(t)
    setStatusFilter('')
    setPage(1)
  }

  const STATUS_OPTIONS = [
    { value: '', label: 'Все статусы' },
    ...RECEIPT_STATUS_ORDER.filter((s) => s !== 'draft').map((s) => ({ value: s, label: RECEIPT_STATUS_LABELS[s] })),
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
      subtitle={`Всего: ${total}`}
      actions={
        <>
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
          <button className="btn primary" onClick={() => navigate('/inventory/receipts/new')}>
            <Icon name="plus" size={14} />Новое поступление
          </button>
        </>
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220 }}
              placeholder="Номер или клиент…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => { setClientId(v); setPage(1) }}
            placeholder="Поиск клиента…"
          />
          <DateRange
            from={dateFrom} to={dateTo}
            onFromChange={(v) => { setDateFrom(v); setPage(1) }}
            onToChange={(v) => { setDateTo(v); setPage(1) }}
            onClear={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
          />
          <FilterSelect
            label="Статус"
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={(v) => { setStatusFilter(v as ReceiptStatus | ''); setPage(1) }}
          />
          {(clientId || dateFrom || dateTo || statusFilter) && (
            <button className="btn ghost sm" onClick={() => { setClientId(''); setDateFrom(''); setDateTo(''); setStatusFilter(''); setPage(1) }}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      }
    >
      {view === 'table' ? (
        <>
          <div className="tabs" style={{ marginBottom: 14 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => handleTabChange(t.id)}
              >
                {t.label}
                <span className="tab-count">{summary[t.id]}</span>
              </button>
            ))}
          </div>

          <Table>
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th style={{ width: 150 }}>Номер</th>
                <th>Клиент</th>
                <th style={{ width: 120 }}>Дата прибытия</th>
                <th style={{ width: 70, textAlign: 'right' }}>SKU</th>
                <th style={{ width: 100, textAlign: 'right' }}>План, шт</th>
                <th style={{ width: 130 }}>Статус</th>
                <th style={{ width: 160 }}>Проверка</th>
                <th style={{ width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={9} />
              ) : loadError ? (
                <tr>
                  <td colSpan={9}>
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
                  <td colSpan={9}>
                    <EmptyState
                      title="Документов нет"
                      sub={tab === 'overdue' ? 'Просроченных документов нет' : 'Создайте первый документ поступления'}
                      action={
                        tab === 'all' ? (
                          <button className="btn primary" onClick={() => navigate('/inventory/receipts/new')}>
                            <Icon name="plus" size={14} />Новое поступление
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                items.map((item) => {
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
                          {fmtDate(item.arrival_date)}
                        </span>
                      </Td>
                      <Td className="num">{item.sku_count}</Td>
                      <Td className="num">{item.total_planned.toLocaleString('ru-RU')}</Td>
                      <Td>
                        <Badge tone={receiptStatusTone(item.status) as BadgeTone} dot>
                          {RECEIPT_STATUS_LABELS[item.status]}
                        </Badge>
                      </Td>
                      <Td>
                        {(() => {
                          const processed = item.total_accepted + item.total_defect
                          const pct = item.total_planned > 0 ? Math.min(100, Math.round(processed / item.total_planned * 100)) : 0
                          const isActive = item.status === 'on_review' || item.status === 'done'
                          if (!isActive) return <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
                          return (
                            <div style={{ minWidth: 120 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
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
                              {item.total_defect > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--c-warning)', fontWeight: 500 }}>
                                  <Icon name="alert" size={10} />
                                  <span>{item.total_defect} брак</span>
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </Td>
                      <Td>
                        <Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} />
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
        <KanbanBoard items={kanbanItems} loading={loading} onNavigate={(id) => navigate(`/inventory/receipts/${id}`)} />
      )}
    </ListPage>
  )
}

function KanbanBoard({ items, loading, onNavigate }: {
  items: ReceiptListItem[]
  loading: boolean
  onNavigate: (id: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'start' }}>
      {KANBAN_COLS.map((col) => {
        const colItems = items.filter((i) => i.status === col.status)
        return (
          <div key={col.status} style={{ background: 'var(--c-bg-sunken)', borderRadius: 10, padding: 10, minHeight: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px 10px', gap: 8 }}>
              <Badge tone={col.tone} dot>{col.label}</Badge>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{loading ? '…' : colItems.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {colItems.map((item) => {
                const overdue = isReceiptOverdue(item)
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
                        {item.arrival_date ? new Date(item.arrival_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—'}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{item.client_name ?? '—'}</div>
                    {item.supplier_name && (
                      <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 4 }}>{item.supplier_name}</div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{item.total_planned} шт</span>
                      <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>·</span>
                      <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{item.sku_count} SKU</span>
                      {item.total_defect > 0 && (
                        <>
                          <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>·</span>
                          <span style={{ fontSize: 12, color: 'var(--c-warning)', fontWeight: 500 }}>брак: {item.total_defect}</span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
