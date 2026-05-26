import type React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getReceipts,
  arriveReceipt,
  advanceReceiptStatus,
  RECEIPT_STATUS_LABELS,
  RECEIPT_STATUS_ORDER,
  receiptStatusTone,
  receiptQcStatus,
  isReceiptOverdue,
} from '../../api/receiptsApi'
import type { ReceiptListItem, ReceiptListResponse, ReceiptStatus } from '../../api/receiptsApi'
import { getInventoryClients } from '../../api/inventoryLookupsApi'
import type { DictionaryItem } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { Table, Td } from '../data/Table'
import { Pagination } from '../data/Pagination'
import { FiltersBar, FilterChip, FilterSelect } from '../data/FiltersBar'
import { DateRange } from '../data/DateRange'
import { Badge } from '../primitives/Badge'
import type { BadgeTone } from '../primitives/Badge'
import { Icon } from '../primitives/Icon'
import { SkeletonRows } from '../primitives/Skeleton'
import { EmptyState } from '../primitives/EmptyState'

const PAGE_SIZE = 25

type TabId = 'all' | 'active' | 'overdue' | 'done' | 'drafts'

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'В работе' },
  { id: 'overdue', label: 'Просрочка' },
  { id: 'done', label: 'Завершённые' },
  { id: 'drafts', label: 'Планирование' },
]

const KANBAN_COLS: { status: ReceiptStatus; label: string; tone: string }[] = [
  { status: 'draft',     label: 'Планирование', tone: '' },
  { status: 'planned',   label: 'В пути',       tone: 'info' },
  { status: 'on_review', label: 'На проверке',  tone: 'warning' },
  { status: 'done',      label: 'Завершён',      tone: 'success' },
]

const ADVANCE_LABELS: Partial<Record<ReceiptStatus, string>> = {
  draft:     'В путь',
  planned:   'На проверку',
  on_review: 'Завершить',
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU')
}

export function InventoryReceiptsListPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabId>('all')
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState<ReceiptStatus | ''>('')
  const [allItems, setAllItems] = useState<ReceiptListItem[]>([])
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [advancingId, setAdvancingId] = useState<string | null>(null)

  useEffect(() => { getInventoryClients().then(setClients).catch(() => {}) }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res: ReceiptListResponse = await getReceipts({
        page: 1,
        limit: 200,
        search: search.trim() || undefined,
        client_id: clientId || undefined,
        status: statusFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      })
      setAllItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [search, clientId, statusFilter, dateFrom, dateTo])

  async function handleAdvance(e: React.MouseEvent, item: ReceiptListItem) {
    e.stopPropagation()
    setAdvancingId(item.id)
    try {
      if (item.status === 'draft') await arriveReceipt(item.id)
      else await advanceReceiptStatus(item.id)
      load()
    } finally {
      setAdvancingId(null)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const filtered = allItems.filter((r) => {
    if (tab === 'active' && r.status === 'done') return false
    if (tab === 'active' && r.status === 'draft') return false
    if (tab === 'done' && r.status !== 'done') return false
    if (tab === 'drafts' && r.status !== 'draft') return false
    if (tab === 'overdue' && !isReceiptOverdue(r)) return false
    return true
  })

  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const tabCounts = {
    all: allItems.length,
    active: allItems.filter((r) => r.status !== 'done' && r.status !== 'draft').length,
    overdue: allItems.filter(isReceiptOverdue).length,
    done: allItems.filter((r) => r.status === 'done').length,
    drafts: allItems.filter((r) => r.status === 'draft').length,
  }

  const STATUS_OPTIONS = RECEIPT_STATUS_ORDER.filter((s) => s !== 'draft')

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
          <FilterSelect
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => { setClientId(v); setPage(1) }}
          />
          <DateRange
            from={dateFrom} to={dateTo}
            onFromChange={(v) => { setDateFrom(v); setPage(1) }}
            onToChange={(v) => { setDateTo(v); setPage(1) }}
            onClear={() => { setDateFrom(''); setDateTo(''); setPage(1) }}
          />
          {STATUS_OPTIONS.map((s) => (
            <FilterChip
              key={s}
              label={RECEIPT_STATUS_LABELS[s]}
              active={statusFilter === s}
              onClick={() => { setStatusFilter(statusFilter === s ? '' : s); setPage(1) }}
              onClear={() => { setStatusFilter(''); setPage(1) }}
            />
          ))}
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
          {/* Вкладки */}
          <div className="tabs" style={{ marginBottom: 14 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => { setTab(t.id); setPage(1) }}
              >
                {t.label}
                <span className="tab-count">{tabCounts[t.id]}</span>
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
                <th style={{ width: 80, textAlign: 'right' }}>Брак</th>
                <th style={{ width: 140 }}>Проверка</th>
                <th style={{ width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={10} />
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={10}>
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
                paginated.map((item) => {
                  const overdue = isReceiptOverdue(item)
                  const qc = receiptQcStatus(item)
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
                      <Td className="num">
                        {item.total_defect > 0 ? (
                          <span style={{ color: 'var(--c-warning)', fontWeight: 500 }}>{item.total_defect}</span>
                        ) : (
                          <span style={{ color: 'var(--c-text-faint)' }}>—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={qc.tone as BadgeTone}>{qc.label}</Badge>
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, gap: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
              <Icon name="shield" size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Сортировка: по дате прибытия ↓ · показано {filtered.length} из {allItems.length}
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: 'var(--c-text-faint)' }}>
              Сортировка: по дате прибытия ↓
            </span>
          </div>
        </>
      ) : (
        <KanbanBoard items={allItems} loading={loading} onAdvance={handleAdvance} advancingId={advancingId} onNavigate={(id) => navigate(`/inventory/receipts/${id}`)} />
      )}
    </ListPage>
  )
}

function KanbanBoard({ items, loading, onAdvance, advancingId, onNavigate }: {
  items: ReceiptListItem[]
  loading: boolean
  onAdvance: (e: React.MouseEvent, item: ReceiptListItem) => void
  advancingId: string | null
  onNavigate: (id: string) => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'start' }}>
      {KANBAN_COLS.map((col) => {
        const colItems = items.filter((i) => i.status === col.status)
        return (
          <div key={col.status} style={{ background: 'var(--c-bg-sunken)', borderRadius: 10, padding: 10, minHeight: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px 10px', gap: 8 }}>
              <Badge tone={col.tone as any} dot>{col.label}</Badge>
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
                      {ADVANCE_LABELS[item.status] && (
                        <button
                          className="btn ghost sm"
                          style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11.5 }}
                          disabled={advancingId === item.id}
                          onClick={(e) => onAdvance(e, item)}
                        >
                          {ADVANCE_LABELS[item.status]}
                        </button>
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
