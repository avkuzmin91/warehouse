import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getMpAccounts,
  getMpOrders,
  getMpOrdersSummary,
  isMpOrderOverdue,
  MARKETPLACE_LABELS,
  marketplaceTone,
  MP_ORDER_STATUS_LABELS,
  mpOrderStatusTone,
} from '../../../api/marketplacesApi'
import type { MpOrderListItem } from '../../../api/marketplacesApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../data/FiltersBar'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtDateTime } from '../../../utils/format'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { useFilterParam, usePageParam, useFilterParamsActions } from '../../../hooks/useFilterParams'

const PAGE_SIZE = 25

const MARKETPLACE_OPTIONS = [
  { value: '', label: 'Все маркетплейсы' },
  { value: 'ozon', label: MARKETPLACE_LABELS.ozon },
  { value: 'wb', label: MARKETPLACE_LABELS.wb },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Активные' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'new', label: MP_ORDER_STATUS_LABELS.new },
  { value: 'in_progress', label: MP_ORDER_STATUS_LABELS.in_progress },
  { value: 'shipped', label: MP_ORDER_STATUS_LABELS.shipped },
  { value: 'done', label: MP_ORDER_STATUS_LABELS.done },
  { value: 'cancelled', label: MP_ORDER_STATUS_LABELS.cancelled },
]

export function MpOrdersFeature() {
  const navigate = useNavigate()
  const { clients } = useLookups()

  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [marketplace, setMarketplace] = useFilterParam('mp', '')
  const [accountId, setAccountId] = useFilterParam('account', '')
  const [statusFilter, setStatusFilter] = useFilterParam('status', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

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

  const { data: accountsData } = useApi((s) => getMpAccounts(s), [])
  const accounts = accountsData?.items ?? []

  const commonParams = {
    account_id: accountId || undefined,
    client_id: clientId || undefined,
    marketplace: marketplace || undefined,
    search: search.trim() || undefined,
  }

  const { data, loading, error } = useApi(
    (signal) => getMpOrders({
      page, limit: PAGE_SIZE,
      ...commonParams,
      status: statusParam,
      overdue: isOverdue || undefined,
    }, signal),
    [page, search, clientId, marketplace, accountId, statusParam, isOverdue],
  )

  const { data: summary } = useApi(
    (signal) => getMpOrdersSummary(commonParams, signal),
    [search, clientId, marketplace, accountId],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const colCount = 8

  return (
    <ListPage
      title="FBS-заказы"
      subtitle="Заказы маркетплейсов по схеме FBS — монитор всех подключённых кабинетов"
      filters={
        <FiltersBar>
          <input
            className="input sm"
            placeholder="Поиск: № заказа, товар, артикул…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240 }}
          />
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setClientId}
            placeholder="Поиск клиента…"
          />
          <FilterSelect label="Маркетплейс" value={marketplace} options={MARKETPLACE_OPTIONS} onChange={setMarketplace} />
          <FilterSelect
            label="Кабинет"
            value={accountId}
            options={[{ value: '', label: 'Все кабинеты' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
            onChange={setAccountId}
          />
          <FilterSelect label="Статус" value={statusFilter} options={STATUS_OPTIONS} onChange={setStatusFilter} />
          {(search || clientId || marketplace || accountId || statusFilter) && (
            <button className="btn ghost sm" onClick={() => setMany({ search: '', client: '', mp: '', account: '', status: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          {summary && (
            <div className="row gap-8" style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
              <span>Ждёт сборки: <b style={{ color: 'var(--c-text)' }}>{summary.by_status.new ?? 0}</b></span>
              <span>В работе: <b style={{ color: 'var(--c-text)' }}>{summary.by_status.in_progress ?? 0}</b></span>
              <span>Просрочено: <b style={{ color: summary.overdue_count > 0 ? 'var(--c-danger)' : 'var(--c-text)' }}>{summary.overdue_count}</b></span>
            </div>
          )}
        </FiltersBar>
      }
    >
      <Table>
        <thead>
          <tr>
            <th style={{ width: 160 }}>№ заказа</th>
            <th style={{ width: 110 }}>Маркетплейс</th>
            <th>Кабинет / клиент</th>
            <th style={{ width: 110, textAlign: 'right' }}>Состав</th>
            <th style={{ width: 140 }}>Создан</th>
            <th style={{ width: 150 }}>Дедлайн сборки</th>
            <th style={{ width: 150 }}>Статус</th>
            <th style={{ width: 120 }}>Связка</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={colCount} />
          ) : error ? (
            <tr><td colSpan={colCount}><EmptyState title="Не удалось загрузить" sub={error.message} /></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={colCount}>
              <EmptyState
                title="Заказов нет"
                sub="Заказы появятся после подключения кабинета продавца (раздел «Подключения») — синхронизация идёт автоматически."
              />
            </td></tr>
          ) : (
            items.map((it) => <OrderRow key={it.id} item={it} onOpen={() => navigate(`/marketplaces/orders/${it.id}`)} />)
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </ListPage>
  )
}

function OrderRow({ item, onOpen }: { item: MpOrderListItem; onOpen: () => void }) {
  const overdue = isMpOrderOverdue(item)
  const unlinked = item.lines_linked < item.lines_total
  return (
    <tr onClick={onOpen} style={{ cursor: 'pointer' }}>
      <Td className="mono" style={{ fontWeight: 600 }}>{item.external_id}</Td>
      <Td><Badge tone={marketplaceTone(item.marketplace)}>{MARKETPLACE_LABELS[item.marketplace]}</Badge></Td>
      <Td>
        {item.account_name}
        {item.client_name && <span style={{ color: 'var(--c-text-subtle)' }}> · {item.client_name}</span>}
      </Td>
      <Td className="num">{item.lines_total} поз. / {item.total_qty} шт.</Td>
      <Td style={{ color: 'var(--c-text-subtle)' }}>{item.created_at_mp ? fmtDateTime(item.created_at_mp) : '—'}</Td>
      <Td style={{ color: overdue ? 'var(--c-danger)' : undefined, fontWeight: overdue ? 600 : undefined }}>
        {item.deadline_at
          ? <>
              {item.deadline_source === 'estimated' && (
                <span title="Расчётный дедлайн: WB не отдаёт срок сборки, считаем от создания заказа">~</span>
              )}
              {fmtDateTime(item.deadline_at)}
            </>
          : '—'}
      </Td>
      <Td><Badge tone={mpOrderStatusTone(item.status)}>{MP_ORDER_STATUS_LABELS[item.status]}</Badge></Td>
      <Td>
        {unlinked
          ? (
            <span title="В заказе есть товары, не связанные с товарами WMS">
              <Badge tone="warning" dot>не связан</Badge>
            </span>
          )
          : <Icon name="check" size={14} style={{ color: 'var(--c-success)' }} />}
      </Td>
    </tr>
  )
}
