import { useEffect, useState } from 'react'
import {
  getMpAccounts,
  getMpStockReport,
  MARKETPLACE_LABELS,
  MP_STOCK_NOTE_LABELS,
  MP_STOCK_SKIP_LABELS,
  pushMpAccountStocks,
} from '../../../api/marketplacesApi'
import type { MpAccountItem, MpStockRow } from '../../../api/marketplacesApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { FiltersBar, FilterSelect } from '../../data/FiltersBar'
import { useToast } from '../../feedback/Toast'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam } from '../../../hooks/useFilterParams'
import { fmtDateTime } from '../../../utils/format'

const TABS = [
  { key: '', label: 'Все карточки' },
  { key: 'diff', label: 'Расхождения' },
] as const

export function MpStocksFeature() {
  const toast = useToast()

  const [accountId, setAccountId] = useFilterParam('account', '')
  const [tab, setTab] = useFilterParam('view', '')
  const [search, setSearch] = useFilterParam('search', '')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const { data: accountsData } = useApi((s) => getMpAccounts(s), [])
  const accounts = (accountsData?.items ?? []).filter((a) => a.marketplace === 'wb')
  const account: MpAccountItem | null = accounts.find((a) => a.id === accountId) ?? null

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length])

  const { data, loading, error } = useApi(
    (signal) => accountId
      ? getMpStockReport({
          account_id: accountId,
          only_diff: tab === 'diff',
          search: search.trim() || undefined,
        }, signal)
      : Promise.resolve(null),
    [accountId, tab, search, reloadKey],
  )

  const items = data?.items ?? []
  const colCount = 7

  const handlePush = (full: boolean) => async () => {
    if (busy || !accountId) return
    setBusy(true)
    try {
      const res = await pushMpAccountStocks(accountId, { full })
      toast(`Выгружено в маркетплейс: ${res.stats.pushed ?? 0} ШК из ${res.stats.skus ?? 0}`)
      setReloadKey((k) => k + 1)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось выгрузить остатки', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ListPage
      title="Остатки на маркетплейсе"
      subtitle="Доступно к продаже = годный остаток на хранении − резерв отгрузок − незакрытые FBS-заказы"
      actions={
        accountId ? (
          <>
            <button className="btn" onClick={handlePush(false)} disabled={busy}>
              <Icon name="upload" size={14} />Выгрузить изменения
            </button>
            <button className="btn" onClick={handlePush(true)} disabled={busy}>
              <Icon name="refresh" size={14} />Выгрузить всё заново
            </button>
          </>
        ) : undefined
      }
      filters={
        <FiltersBar>
          <FilterSelect
            label="Кабинет"
            value={accountId}
            options={accounts.map((a) => ({
              value: a.id,
              label: `${a.name} (${MARKETPLACE_LABELS[a.marketplace]})`,
            }))}
            onChange={setAccountId}
          />
          <input
            className="input sm"
            placeholder="Поиск: артикул, SKU, ШК…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240 }}
          />
          <div className="tabs" style={{ marginLeft: 'auto' }}>
            {TABS.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </FiltersBar>
      }
    >
      {accounts.length === 0 && !loading ? (
        <EmptyState
          title="Нет кабинетов Wildberries"
          sub="Подключите кабинет WB в разделе «Подключения» и выберите склад продавца — только после этого остатки поедут в маркетплейс."
        />
      ) : (
        <>
          {account && !account.stock_sync_enabled && (
            <div className="card" style={{ padding: 12, marginBottom: 12, color: 'var(--c-warning)' }}>
              Автовыгрузка остатков для этого кабинета выключена — маркетплейс получит числа только по кнопке.
              Включить можно в «Подключениях».
            </div>
          )}
          {account?.last_stock_push_error && (
            <div className="card" style={{ padding: 12, marginBottom: 12, color: 'var(--c-danger)' }}>
              Последняя выгрузка не удалась: {account.last_stock_push_error}
            </div>
          )}
          {data?.marketplace_error && (
            <div className="card" style={{ padding: 12, marginBottom: 12, color: 'var(--c-danger)' }}>
              Не удалось получить остатки маркетплейса для сверки: {data.marketplace_error}
            </div>
          )}
          {account?.last_stock_push_at && (
            <div className="t-sub" style={{ marginBottom: 8 }}>
              Последняя выгрузка: {fmtDateTime(account.last_stock_push_at)}
              {account.stock_warehouse_name ? ` · склад «${account.stock_warehouse_name}»` : ''}
            </div>
          )}
          <Table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Артикул МП</th>
                <th>Карточка</th>
                <th>Товар WMS</th>
                <th style={{ width: 90, textAlign: 'right' }}>Доступно</th>
                <th style={{ width: 100, textAlign: 'right' }}>Выгружено</th>
                <th style={{ width: 90, textAlign: 'right' }}>В МП</th>
                <th style={{ width: 130 }}>Расхождение</th>
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
                    title={tab === 'diff' ? 'Расхождений нет' : 'Карточек нет'}
                    sub={tab === 'diff' ? 'Остатки в системе и в маркетплейсе совпадают' : 'Обновите карточки кабинета в разделе «Связка товаров»'}
                  />
                </td></tr>
              ) : (
                items.map((row) => <StockRow key={row.mp_product_id} row={row} />)
              )}
            </tbody>
          </Table>
        </>
      )}
    </ListPage>
  )
}

function StockRow({ row }: { row: MpStockRow }) {
  const wmsName = [row.product_name, row.color_name, row.size_name].filter(Boolean).join(' · ')
  return (
    <tr>
      <Td className="mono">{row.offer_id ?? row.external_id}</Td>
      <Td>
        <div>{row.title ?? '—'}</div>
        <div className="t-sub mono" style={{ fontSize: 12 }}>
          {row.external_size ? `${row.external_size} · ` : ''}{row.barcodes.join(', ') || 'без ШК'}
        </div>
      </Td>
      <Td>
        {row.product_id ? (
          <>
            <div>{wmsName || '—'}</div>
            <div className="t-sub mono" style={{ fontSize: 12 }}>{row.product_sku ?? ''}</div>
          </>
        ) : (
          <span style={{ color: 'var(--c-text-faint)' }}>—</span>
        )}
      </Td>
      <Td className="num">{row.qty ?? '—'}</Td>
      <Td className="num">{row.pushed_qty ?? '—'}</Td>
      <Td className="num">{row.mp_qty ?? '—'}</Td>
      <Td>
        {row.skip_reason ? (
          <Badge tone="warning">{MP_STOCK_SKIP_LABELS[row.skip_reason]}</Badge>
        ) : row.diff === null ? (
          <span style={{ color: 'var(--c-text-faint)' }}>—</span>
        ) : row.diff === 0 ? (
          <Badge tone="success">совпадает</Badge>
        ) : (
          <Badge tone="danger">{row.diff > 0 ? `+${row.diff}` : row.diff}</Badge>
        )}
        {row.note && (
          <div className="t-sub" style={{ fontSize: 12 }}>{MP_STOCK_NOTE_LABELS[row.note]}</div>
        )}
      </Td>
    </tr>
  )
}
