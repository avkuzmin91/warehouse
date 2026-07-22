import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getInvoices,
  getInvoiceAlerts,
  INVOICE_STATUS_LABELS,
  invoiceStatusTone,
} from '../../../api/invoicesApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../data/FiltersBar'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtDate } from '../../../utils/format'
import { useLookups } from '../../../hooks/useLookups'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'
import { Kpi, PayBar, kpiMoney } from './financeUI'

const PAGE_SIZE = 25

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'overdue', label: 'Просрочка' },
  { value: 'draft', label: INVOICE_STATUS_LABELS.draft },
  { value: 'issued', label: INVOICE_STATUS_LABELS.issued },
  { value: 'partially_paid', label: INVOICE_STATUS_LABELS.partially_paid },
  { value: 'closed', label: INVOICE_STATUS_LABELS.closed },
  { value: 'cancelled', label: INVOICE_STATUS_LABELS.cancelled },
]

export function InvoicesListFeature() {
  const navigate = useNavigate()

  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [statusFilter, setStatusFilter] = useFilterParam('status', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const { clients } = useLookups()

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

  const isOverdue = statusFilter === 'overdue'
  const statusParam = !statusFilter || isOverdue ? undefined : statusFilter
  const overdueParam = isOverdue || undefined

  const { data, loading, error } = useApi(
    (signal) => getInvoices({
      page, limit: PAGE_SIZE,
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      status: statusParam,
      overdue: overdueParam,
    }, signal),
    [page, search, clientId, statusParam, overdueParam],
  )

  const { data: alerts } = useApi((signal) => getInvoiceAlerts(clientId || undefined, signal), [clientId])

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <ListPage
      title="Счета"
      subtitle={alerts ? `Всего: ${total} · активных ${alerts.active_count}` : `Всего: ${total}`}
      actions={
        <>
          <button className="btn" onClick={() => navigate('/finance/uninvoiced')}>
            <Icon name="inbox" size={14} />Без счёта
          </button>
          <button className="btn primary" onClick={() => navigate('/finance/invoices/new')}>
            <Icon name="plus" size={14} />Новый счёт
          </button>
        </>
      }
    >
      {alerts && (
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
          <Kpi icon="receipt" label="Активных счетов" value={alerts.active_count} sub="выставлено и частично" />
          <Kpi icon="wallet" label="К оплате" value={kpiMoney(alerts.active_outstanding)} sub="остаток по активным" />
          <Kpi icon="bell" label="Срок наступил" value={alerts.due_count} sub="нужно проверить оплату" tone={alerts.due_count > 0 ? 'warning' : 'default'} />
          <Kpi icon="alert" label="Просрочено" value={alerts.overdue_count} sub="срок расчёта прошёл" tone={alerts.overdue_count > 0 ? 'danger' : 'default'} />
        </div>
      )}

      {alerts && alerts.due_count > 0 && !isOverdue && (
        <div
          onClick={() => setStatusFilter('overdue')}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            padding: '10px 14px', marginBottom: 14, borderRadius: 'var(--r-lg)',
            border: '1px solid var(--c-border)',
            background: 'color-mix(in oklab, var(--c-warning) 8%, transparent)',
            borderLeft: '3px solid var(--c-warning)',
          }}
        >
          <Icon name="bell" size={15} style={{ color: 'var(--c-warning)' }} />
          <span style={{ fontSize: 13 }}>
            Срок расчёта наступил у <b>{alerts.due_count}</b> {plural(alerts.due_count, 'счёта', 'счетов', 'счетов')}
            {alerts.overdue_count > 0 && <> · из них просрочено <b style={{ color: 'var(--c-danger)' }}>{alerts.overdue_count}</b></>}
            <span style={{ color: 'var(--c-text-subtle)' }}> — уведомление отправлено менеджеру и админу</span>
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--c-accent-text)', fontWeight: 500 }}>Показать →</span>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: searchInput ? 26 : undefined }}
              placeholder="Номер или клиент…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearchInput(''); setSearch('') }}
              ><Icon name="x" size={12} /></button>
            )}
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => setClientId(v)}
            placeholder="Поиск клиента…"
          />
          <FilterSelect label="Статус" value={statusFilter} options={STATUS_OPTIONS} onChange={(v) => setStatusFilter(v)} />
          {(clientId || statusFilter || search) && (
            <button className="btn ghost sm" onClick={() => setMany({ client: '', status: '', search: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      </div>

      <Table>
        <thead>
          <tr>
            <th style={{ width: 22 }} />
            <th style={{ width: 140 }}>Номер</th>
            <th>Клиент</th>
            <th style={{ width: 120 }}>Срок расчёта</th>
            <th style={{ width: 140, textAlign: 'right' }}>Сумма</th>
            <th style={{ width: 175, textAlign: 'right' }}>Оплачено</th>
            <th style={{ width: 80, textAlign: 'right' }} title="Отгрузки + поступления">Док.</th>
            <th style={{ width: 150 }}>Статус</th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={9} />
          ) : error ? (
            <tr><td colSpan={9}><EmptyState title="Не удалось загрузить счета" sub={error.message} /></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={9}>
              <EmptyState
                title="Счетов нет"
                sub={isOverdue ? 'Просроченных счетов нет' : 'Создайте первый счёт'}
                action={!statusFilter ? (
                  <button className="btn primary" onClick={() => navigate('/finance/invoices/new')}>
                    <Icon name="plus" size={14} />Новый счёт
                  </button>
                ) : undefined}
              />
            </td></tr>
          ) : (
            items.map((item) => (
              <tr
                key={item.id}
                onClick={() => navigate(`/finance/invoices/${item.id}`)}
                style={item.overdue ? {
                  background: 'color-mix(in oklab, var(--c-danger) 5%, transparent)',
                  boxShadow: 'inset 2px 0 0 var(--c-danger)',
                } : {}}
              >
                <Td style={{ paddingLeft: 8 }}>
                  {item.overdue && <Icon name="alert" size={14} style={{ color: 'var(--c-danger)' }} title="Просрочен" />}
                </Td>
                <Td><span className="mono" style={{ fontWeight: 500 }}>{item.doc_number}</span></Td>
                <Td>{item.client_name ?? '—'}</Td>
                <Td>
                  <span className="mono" style={item.overdue ? { color: 'var(--c-danger)', fontWeight: 600, fontSize: 12.5 } : { color: 'var(--c-text-subtle)', fontSize: 12.5 }}>
                    {fmtDate(item.due_date)}
                  </span>
                </Td>
                <Td className="num">{formatTotal(item.total_amount)}</Td>
                <Td><PayBar total={item.total_amount} paid={item.paid_amount} /></Td>
                <Td className="num">{item.shipment_count + item.receipt_count}</Td>
                <Td><Badge tone={invoiceStatusTone(item.status)} dot>{item.status_label}</Badge></Td>
                <Td><Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} /></Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </ListPage>
  )
}

function formatTotal(kopecks: number): string {
  const rub = Math.floor(kopecks / 100)
  const kop = kopecks % 100
  return kop === 0 ? `${rub.toLocaleString('ru-RU')} ₽` : `${rub.toLocaleString('ru-RU')},${String(kop).padStart(2, '0')} ₽`
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
