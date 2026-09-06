import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  createMpSupply,
  getMpAccounts,
  getMpOrders,
  getMpOrdersSummary,
  isMpOrderOverdue,
  MARKETPLACE_LABELS,
  MP_ORDER_BLOCKER_LABELS,
  MP_ORDER_STAGE_LABELS,
  MP_ORDER_STATUS_LABELS,
  MP_SUPPLY_STATUS_LABELS,
  mpOrderStageTone,
  primaryMpOrderBlocker,
  syncMpAccountOrders,
} from '../../../api/marketplacesApi'
import type { MpOrderListItem, MpOrdersSummary } from '../../../api/marketplacesApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../data/FiltersBar'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { useToast } from '../../feedback/Toast'
import { fmtDateTime, fmtDurationShort } from '../../../utils/format'
import { useApi } from '../../../hooks/useApi'
import { useLookups } from '../../../hooks/useLookups'
import { useFilterParam, usePageParam, useFilterParamsActions } from '../../../hooks/useFilterParams'

const PAGE_SIZE = 25

const MARKETPLACE_OPTIONS = [
  { value: '', label: 'Все маркетплейсы' },
  { value: 'ozon', label: MARKETPLACE_LABELS.ozon },
  { value: 'wb', label: MARKETPLACE_LABELS.wb },
]

/** Только статус площадки. Операционные срезы (просрочка, без поставки, ошибка) —
 *  отдельные вкладки: они не взаимоисключающие со статусом и должны с ним складываться. */
const STATUS_OPTIONS = [
  { value: '', label: 'Активные' },
  { value: 'new', label: MP_ORDER_STATUS_LABELS.new },
  { value: 'in_progress', label: MP_ORDER_STATUS_LABELS.in_progress },
  { value: 'shipped', label: MP_ORDER_STATUS_LABELS.shipped },
  { value: 'done', label: MP_ORDER_STATUS_LABELS.done },
  { value: 'cancelled', label: MP_ORDER_STATUS_LABELS.cancelled },
]

const KNOWN_STATUSES = new Set(STATUS_OPTIONS.map((o) => o.value))

export function MpOrdersFeature() {
  const navigate = useNavigate()
  const toast = useToast()
  const { clients } = useLookups()

  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [marketplace, setMarketplace] = useFilterParam('mp', '')
  const [accountId, setAccountId] = useFilterParam('account', '')
  const [statusRaw, setStatusFilter] = useFilterParam('status', '')
  const [view, setView] = useFilterParam('view', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const [tick, setTick] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Старые ссылки клали в `status` псевдо-значения (overdue/no_supply); backend
  // такой статус не примет, поэтому чужое значение просто игнорируем.
  const statusFilter = KNOWN_STATUSES.has(statusRaw) ? statusRaw : ''

  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

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
      status: statusFilter || undefined,
      overdue: view === 'overdue' || undefined,
      no_supply: view === 'no_supply' || undefined,
      has_error: view === 'error' || undefined,
    }, signal),
    [page, search, clientId, marketplace, accountId, statusFilter, view, tick],
  )

  const { data: summary } = useApi(
    (signal) => getMpOrdersSummary(commonParams, signal),
    [search, clientId, marketplace, accountId, tick],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const showAccount = !accountId
  const colCount = showAccount ? 7 : 6

  // Поставка заводится по одному кабинету, поэтому и выбор к нему привязан:
  // разрешить отметить чужой заказ, чтобы потом отказать, — обман.
  const selectionAccount = useMemo(
    () => items.find((i) => selected.has(i.id))?.account_id ?? null,
    [items, selected],
  )
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const createSupply = async () => {
    if (!selectionAccount) return
    setCreating(true)
    try {
      const res = await createMpSupply({ account_id: selectionAccount, order_ids: [...selected] })
      navigate(`/marketplaces/supplies/${res.message}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось завести поставку', 'error')
      setCreating(false)
    }
  }

  const runSync = async () => {
    if (!accountId) return
    setSyncing(true)
    try {
      const res = await syncMpAccountOrders(accountId)
      toast(res.message)
      setTick((t) => t + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Синхронизация не удалась', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const filtersDirty = Boolean(search || clientId || marketplace || accountId || statusFilter || view)

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
          {filtersDirty && (
            <button
              className="btn ghost sm"
              onClick={() => setMany({ search: '', client: '', mp: '', account: '', status: '', view: '' })}
            >
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          <div className="row gap-8" style={{ marginLeft: 'auto', alignItems: 'center' }}>
            <SyncStamp summary={summary} />
            {accountId && (
              <button className="btn ghost sm" onClick={runSync} disabled={syncing}>
                {syncing ? 'Синхронизация…' : 'Синхронизировать'}
              </button>
            )}
          </div>
        </FiltersBar>
      }
    >
      <div className="tabs" style={{ marginBottom: 10 }}>
        <button className={`tab ${view === '' ? 'active' : ''}`} onClick={() => setView('')}>
          Все активные
          <span className="tab-count">
            {summary ? (summary.by_status.new ?? 0) + (summary.by_status.in_progress ?? 0) : ''}
          </span>
        </button>
        <button className={`tab ${view === 'overdue' ? 'active' : ''}`} onClick={() => setView('overdue')}>
          Просрочено
          <span className="tab-count" style={{ color: summary && summary.overdue_count > 0 ? 'var(--c-danger)' : undefined }}>
            {summary?.overdue_count ?? ''}
          </span>
        </button>
        <button className={`tab ${view === 'no_supply' ? 'active' : ''}`} onClick={() => setView('no_supply')}>
          Без поставки<span className="tab-count">{summary?.no_supply_count ?? ''}</span>
        </button>
        <button className={`tab ${view === 'error' ? 'active' : ''}`} onClick={() => setView('error')}>
          Ошибка площадки
          <span className="tab-count" style={{ color: summary && summary.error_count > 0 ? 'var(--c-danger)' : undefined }}>
            {summary?.error_count ?? ''}
          </span>
        </button>
      </div>

      <UnlinkedBanner summary={summary} accountId={accountId} />

      {selected.size > 0 && (
        <div
          className="card row gap-8"
          style={{ padding: '10px 14px', marginBottom: 10, alignItems: 'center', borderLeft: '3px solid var(--c-accent)' }}
        >
          <span style={{ fontSize: 13 }}>
            Выбрано заказов: <b>{selected.size}</b>
            <span style={{ color: 'var(--c-text-subtle)' }}>
              {' · '}{accounts.find((a) => a.id === selectionAccount)?.name ?? 'кабинет'}
            </span>
          </span>
          <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={createSupply} disabled={creating}>
            {creating ? 'Заводим…' : 'Создать поставку'}
          </button>
          <button className="btn ghost sm" onClick={() => setSelected(new Set())}>Снять выбор</button>
        </div>
      )}

      <Table>
        <thead>
          <tr>
            <th style={{ width: 34 }} />
            <th style={{ width: 150 }}>№ заказа</th>
            {showAccount && <th style={{ width: 190 }}>Кабинет / клиент</th>}
            <th>Состав</th>
            <th style={{ width: 150 }}>Дедлайн сборки</th>
            <th style={{ width: 180 }}>Готовность</th>
            <th style={{ width: 190 }}>Где сейчас</th>
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
            items.map((it) => (
              <OrderRow
                key={it.id}
                item={it}
                showAccount={showAccount}
                checked={selected.has(it.id)}
                selectable={it.stage === 'pool' && (!selectionAccount || selectionAccount === it.account_id)}
                onToggle={() => toggle(it.id)}
                onOpen={() => navigate(`/marketplaces/orders/${it.id}`)}
              />
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </ListPage>
  )
}

/** Монитор принимает решения по числам, которые приносит воркер: без отметки
 *  времени упавший час назад синк выглядит как «заказов больше нет». */
function SyncStamp({ summary }: { summary: MpOrdersSummary | null }) {
  if (!summary) return null
  if (!summary.last_sync_at) {
    return <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>Синхронизация ещё не выполнялась</span>
  }
  const failed = summary.last_sync_ok === false
  const ago = fmtDurationShort(Date.now() - new Date(summary.last_sync_at).getTime())
  return (
    <span
      style={{ fontSize: 12.5, color: failed ? 'var(--c-danger)' : 'var(--c-text-subtle)' }}
      title={failed ? (summary.last_sync_error ?? 'Последний синк завершился ошибкой') : fmtDateTime(summary.last_sync_at)}
    >
      {failed ? 'Синк с ошибкой' : 'Синхронизировано'}: {ago} назад
    </span>
  )
}

/** Несвязанные артикулы — свойство кабинета: один артикул красит десятки строк,
 *  поэтому баннер один, а не бейдж в каждой. */
function UnlinkedBanner({ summary, accountId }: { summary: MpOrdersSummary | null; accountId: string }) {
  if (!summary || summary.unlinked_orders_count === 0) return null
  const offers = summary.unlinked_offers
  return (
    <div
      className="card row gap-8"
      style={{ padding: '10px 14px', marginBottom: 10, alignItems: 'center', borderLeft: '3px solid var(--c-warning)' }}
    >
      <span style={{ fontSize: 13 }}>
        Не связано артикулов: <b>{offers.length}</b>
        {' — блокируют заказов: '}<b>{summary.unlinked_orders_count}</b>
      </span>
      <span className="row gap-8" style={{ flexWrap: 'wrap' }}>
        {offers.slice(0, 6).map((offer) => (
          <span key={offer} className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{offer}</span>
        ))}
        {offers.length > 6 && (
          <span style={{ fontSize: 11.5, color: 'var(--c-text-faint)' }}>ещё {offers.length - 6}</span>
        )}
      </span>
      <Link
        className="btn ghost sm"
        style={{ marginLeft: 'auto' }}
        to={`/marketplaces/links?linked=unlinked${accountId ? `&account=${accountId}` : ''}`}
      >
        Связать товары
      </Link>
    </div>
  )
}

function OrderRow({ item, showAccount, checked, selectable, onToggle, onOpen }: {
  item: MpOrderListItem
  showAccount: boolean
  checked: boolean
  selectable: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <tr onClick={onOpen} style={{ cursor: 'pointer' }}>
      <Td>
        {selectable && (
          <input
            type="checkbox"
            checked={checked}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggle}
            title="Выбрать в новую поставку"
          />
        )}
      </Td>
      <Td>
        <span className="row gap-8" style={{ alignItems: 'center' }}>
          <span
            title={MARKETPLACE_LABELS[item.marketplace]}
            style={{
              width: 6, height: 6, borderRadius: 3, flex: '0 0 auto',
              background: item.marketplace === 'ozon' ? 'var(--c-info)' : 'var(--c-accent)',
            }}
          />
          <span className="mono" style={{ fontWeight: 600 }}>{item.external_id}</span>
        </span>
      </Td>
      {showAccount && (
        <Td>
          <div style={{ fontSize: 12.5 }}>{item.account_name}</div>
          {item.client_name && (
            <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)' }}>{item.client_name}</div>
          )}
        </Td>
      )}
      <Td>
        <div
          title={item.summary || undefined}
          style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {item.summary || `${item.lines_total} поз. / ${item.total_qty} шт.`}
        </div>
        {item.cells.length > 0 && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
            {item.cells.slice(0, 3).join(', ')}{item.cells.length > 3 ? ` +${item.cells.length - 3}` : ''}
          </div>
        )}
      </Td>
      <DeadlineCell item={item} />
      <ReadinessCell item={item} />
      <WhereCell item={item} />
    </tr>
  )
}

function DeadlineCell({ item }: { item: MpOrderListItem }) {
  if (!item.deadline_at) return <Td style={{ color: 'var(--c-text-faint)' }}>—</Td>
  const overdue = isMpOrderOverdue(item)
  const left = fmtDurationShort(new Date(item.deadline_at).getTime() - Date.now())
  const estimated = item.deadline_source === 'estimated'
  const title = [
    `${estimated ? '~' : ''}${fmtDateTime(item.deadline_at)}`,
    item.created_at_mp ? `создан ${fmtDateTime(item.created_at_mp)}` : null,
    estimated ? 'Расчётный дедлайн: WB не отдаёт срок сборки, считаем от создания заказа' : null,
  ].filter(Boolean).join(' · ')
  return (
    <Td style={{ color: overdue ? 'var(--c-danger)' : undefined, fontWeight: overdue ? 600 : undefined }}>
      <span title={title}>
        {overdue ? `просрочен на ${left}` : `через ${left}`}
        {estimated && <span style={{ color: 'var(--c-text-faint)' }}> ~</span>}
      </span>
    </Td>
  )
}

/** Готовность — только про сборку (связка, остаток, место). Ошибка площадки живёт
 *  в «Где сейчас»: она про передачу, а не про то, есть ли что собирать. */
function ReadinessCell({ item }: { item: MpOrderListItem }) {
  if (item.stage !== 'pool' && item.stage !== 'in_supply') {
    return <Td style={{ color: 'var(--c-text-faint)' }}>—</Td>
  }
  const blocker = primaryMpOrderBlocker(item)
  if (!blocker) {
    // Дефицит считается только для свободных заказов: у взятого поставкой остаток
    // уже зарезервирован ею, и «хватит ли» отвечает её собственный экран.
    return item.stage === 'pool'
      ? <Td><Badge tone="success">Готов</Badge></Td>
      : <Td style={{ color: 'var(--c-text-faint)' }}>—</Td>
  }
  if (blocker === 'unlinked') {
    return (
      <Td>
        <span title={`Не связаны артикулы: ${item.unlinked_offers.join(', ') || '—'}`}>
          <Badge tone="warning" dot>
            {MP_ORDER_BLOCKER_LABELS.unlinked}{item.unlinked_offers[0] ? `: ${item.unlinked_offers[0]}` : ''}
          </Badge>
        </span>
      </Td>
    )
  }
  if (blocker === 'shortage') {
    return (
      <Td>
        <span title="Свободного остатка не хватает на этот заказ с учётом более срочных">
          <Badge tone="danger" dot>Не хватает {item.shortage_qty} шт.</Badge>
        </span>
      </Td>
    )
  }
  return (
    <Td>
      <span title="Остаток есть, но лежит без адреса — сборщику некуда идти">
        <Badge tone="warning" dot>{MP_ORDER_BLOCKER_LABELS.no_location}</Badge>
      </span>
    </Td>
  )
}

function WhereCell({ item }: { item: MpOrderListItem }) {
  const phase = item.supply_status ? MP_SUPPLY_STATUS_LABELS[item.supply_status] : null
  return (
    <Td>
      <div className="row gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <span title={`Статус площадки: ${MP_ORDER_STATUS_LABELS[item.status]} (${item.external_status})`}>
          <Badge tone={mpOrderStageTone(item.stage)}>{MP_ORDER_STAGE_LABELS[item.stage]}</Badge>
        </span>
        {item.label_url && (
          <span title="Этикетка площадки получена" style={{ color: 'var(--c-success)' }}>
            <Icon name="tag" size={12} />
          </span>
        )}
      </div>
      {item.supply_number && (
        <div style={{ fontSize: 11.5 }}>
          <Link
            to={`/marketplaces/supplies/${item.supply_id}`}
            className="mono"
            style={{ color: 'var(--c-accent)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {item.supply_number}
          </Link>
          {phase && <span style={{ color: 'var(--c-text-subtle)' }}> · {phase}</span>}
        </div>
      )}
      {item.stage === 'cancelled' && item.supply_id && (
        <div style={{ fontSize: 11.5, color: 'var(--c-danger)', fontWeight: 600 }}>
          Отменён на МП, но взят в поставку — снять из состава
        </div>
      )}
      {item.mp_error && (
        <div
          title={item.mp_error}
          style={{
            fontSize: 11.5, color: 'var(--c-danger)', maxWidth: 180,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          Ошибка площадки: {item.mp_error}
        </div>
      )}
    </Td>
  )
}
