import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  listShipments,
  getShipmentsSummary,
  advanceShipment,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_STATUS_TONES,
  SHIPMENT_STATUS_ORDER,
} from '../../api/shipmentsApi'
import type { ShipmentListItem, ShipmentStatus, ShipmentsSummary } from '../../api/shipmentsApi'
import { getInventoryClients } from '../../api/inventoryLookupsApi'
import type { DictionaryItem } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { Table, Td } from '../data/Table'
import { Pagination } from '../data/Pagination'
import { FiltersBar, FilterSelect, FilterCombobox } from '../data/FiltersBar'
import { DateRange } from '../data/DateRange'
import { Badge } from '../primitives/Badge'
import { Icon } from '../primitives/Icon'
import { SkeletonRows } from '../primitives/Skeleton'
import { EmptyState } from '../primitives/EmptyState'

const PAGE_SIZE = 25

type TabId = 'all' | 'active' | 'packing' | 'ready' | 'done'

const TABS: { id: TabId; label: string }[] = [
  { id: 'all',     label: 'Все' },
  { id: 'active',  label: 'В работе' },
  { id: 'packing', label: 'Сборка' },
  { id: 'ready',   label: 'Готово' },
  { id: 'done',    label: 'Отправлено' },
]

const TAB_STATUS: Partial<Record<TabId, ShipmentStatus>> = {
  packing: 'packing',
  ready:   'ready',
  done:    'shipped',
}

const TAB_MULTI_STATUS: Partial<Record<TabId, ShipmentStatus[]>> = {
  active: ['draft', 'packing', 'ready'],
}

const KANBAN_COLS: { status: ShipmentStatus; label: string; tone: string }[] = [
  { status: 'draft',   label: 'Черновик',   tone: '' },
  { status: 'packing', label: 'Сборка',     tone: 'info' },
  { status: 'ready',   label: 'Готово',     tone: 'accent' },
  { status: 'shipped', label: 'Отправлено', tone: 'success' },
]

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

const ADVANCE_LABELS: Partial<Record<ShipmentStatus, string>> = {
  draft:   'В сборку',
  packing: 'Готово',
  ready:   'Отправить',
}

export function InventoryShipmentsListPage() {
  const navigate = useNavigate()
  const { key: locationKey } = useLocation()
  const [tab, setTab] = useState<TabId>('all')
  const [items, setItems] = useState<ShipmentListItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [initialLoading, setInitialLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [summary, setSummary] = useState<ShipmentsSummary>({ all: 0, active: 0, done: 0, packing: 0, ready: 0 })
  const [kanbanItems, setKanbanItems] = useState<ShipmentListItem[]>([])
  const [advancingId, setAdvancingId] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => { getInventoryClients().then(setClients).catch(() => {}) }, [])

  useEffect(() => {
    getShipmentsSummary({
      client_id: clientId || undefined,
      search: search.trim() || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }).then(setSummary).catch(() => {})
  }, [clientId, search, dateFrom, dateTo, locationKey, reloadTick])

  useEffect(() => {
    if (view !== 'table') return
    setLoading(true)
    const singleStatus = statusFilter || TAB_STATUS[tab]
    const multiStatuses = !statusFilter ? TAB_MULTI_STATUS[tab] : undefined
    const fetchPage = async () => {
      if (multiStatuses) {
        const results = await Promise.all(
          multiStatuses.map((s) =>
            listShipments({
              page: 1, limit: 200,
              search: search.trim() || undefined,
              client_id: clientId || undefined,
              status: s,
              date_from: dateFrom || undefined,
              date_to: dateTo || undefined,
            })
          )
        )
        const merged = results.flatMap((r) => r.items)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
        const offset = (page - 1) * PAGE_SIZE
        setItems(merged.slice(offset, offset + PAGE_SIZE))
        setTotal(merged.length)
      } else {
        const res = await listShipments({
          page, limit: PAGE_SIZE,
          search: search.trim() || undefined,
          client_id: clientId || undefined,
          status: singleStatus || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        })
        setItems(res.items)
        setTotal(res.total)
      }
    }
    fetchPage().catch((e) => console.error(e)).finally(() => {
      setLoading(false)
      setInitialLoading(false)
    })
  }, [view, page, search, clientId, statusFilter, tab, dateFrom, dateTo, locationKey, reloadTick])

  useEffect(() => {
    if (view !== 'kanban') return
    listShipments({
      page: 1, limit: 200,
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }).then((res) => setKanbanItems(res.items)).catch(() => {})
  }, [view, search, clientId, dateFrom, dateTo])

  function handleTabChange(t: TabId) {
    setTab(t)
    setStatusFilter('')
    setPage(1)
  }

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
          <button className="btn primary" onClick={() => navigate('/inventory/shipments/new')}>
            <Icon name="plus" size={14} />Новая отгрузка
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
              placeholder="Номер, клиент, назначение…"
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
            options={[
              { value: '', label: 'Все статусы' },
              ...SHIPMENT_STATUS_ORDER.map((s) => ({ value: s, label: SHIPMENT_STATUS_LABELS[s] })),
            ]}
            onChange={(v) => { setStatusFilter(v as ShipmentStatus | ''); setPage(1) }}
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
                <th style={{ width: 120 }}>Номер</th>
                <th>Клиент</th>
                <th>Назначение</th>
                <th style={{ width: 110 }}>Дата отгрузки</th>
                <th style={{ textAlign: 'right', width: 60 }}>SKU</th>
                <th style={{ textAlign: 'right', width: 80 }}>Кол-во</th>
                <th style={{ width: 130 }}>Перевозчик</th>
                <th style={{ width: 130 }}>Статус</th>
                <th style={{ width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={9} />
              ) : items.length === 0 ? (
                <tr><td colSpan={9}><EmptyState title="Отгрузок нет" sub="Создайте первую отгрузку" /></td></tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/inventory/shipments/${item.id}`)}>
                    <Td className="mono" style={{ fontWeight: 500 }}>{item.doc_number}</Td>
                    <Td>{item.client_name ?? '—'}</Td>
                    <Td className="t-sub">{item.destination ?? '—'}</Td>
                    <Td className="mono">{fmtDate(item.ship_date)}</Td>
                    <Td className="num">{item.sku_count}</Td>
                    <Td className="num">{item.total_qty.toLocaleString('ru-RU')}</Td>
                    <Td>{item.carrier ?? '—'}</Td>
                    <Td>
                      <Badge tone={SHIPMENT_STATUS_TONES[item.status] as any} dot>
                        {item.status_label}
                      </Badge>
                    </Td>
                    <Td>
                      {ADVANCE_LABELS[item.status] && (
                        <button
                          className="btn ghost sm"
                          disabled={advancingId === item.id}
                          onClick={(e) => handleAdvance(e, item)}
                          title={ADVANCE_LABELS[item.status]}
                        >
                          <Icon name="chev" size={13} style={{ transform: 'rotate(-90deg)' }} />
                        </button>
                      )}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </>
      ) : (
        <KanbanBoard items={kanbanItems} loading={loading} onNavigate={(id) => navigate(`/inventory/shipments/${id}`)} />
      )}
    </ListPage>
  )
}

function KanbanBoard({ items, loading, onNavigate }: {
  items: ShipmentListItem[]
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
              <Badge tone={col.tone as any} dot>{col.label}</Badge>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{loading ? '…' : colItems.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {colItems.map((item) => (
                <div
                  key={item.id}
                  className="card"
                  style={{ padding: 10, cursor: 'pointer' }}
                  onClick={() => onNavigate(item.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--c-text-muted)' }}>{item.doc_number}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--c-text-faint)' }}>{fmtDate(item.ship_date)}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{item.client_name ?? '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-subtle)', marginBottom: 8 }}>{item.destination ?? '—'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{item.total_qty} шт</span>
                    <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{item.sku_count} SKU</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
