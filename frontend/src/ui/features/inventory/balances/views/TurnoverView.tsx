import { useState } from 'react'
import { getStockTurnover } from '../../../../../api/balancesApi'
import type { TurnoverItem } from '../../../../../api/balancesApi'
import { useApi } from '../../../../../hooks/useApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { useFilterParam, usePageParam, useFilterParamsActions } from '../../../../../hooks/useFilterParams'
import { Table, Td } from '../../../../data/Table'
import { Pagination } from '../../../../data/Pagination'
import { FiltersBar, FilterChip, FilterCombobox } from '../../../../data/FiltersBar'
import { DateRange } from '../../../../data/DateRange'
import { KPI } from '../../../../primitives/KPI'
import { Icon } from '../../../../primitives/Icon'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'
import { PositionHistoryDrawer } from '../PositionHistoryDrawer'

const PAGE_SIZE = 50

const num = (n: number) => n.toLocaleString('ru-RU')

/** Числовая ячейка оборота: ноль гасим, чтобы взгляд цеплялся за движение. */
function QtyCell({ value, color, prefix }: { value: number; color?: string; prefix?: string }) {
  if (!value) return <Td className="num" style={{ color: 'var(--c-text-faint)' }}>—</Td>
  return (
    <Td className="num" style={{ color, fontWeight: 500 }}>
      {prefix}{num(Math.abs(value))}
    </Td>
  )
}

export function TurnoverView() {
  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [onlyMoved, setOnlyMoved] = useFilterParam('moved', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const { clients } = useLookups()
  const [selected, setSelected] = useState<TurnoverItem | null>(null)

  const { data, loading } = useApi(
    (signal) => getStockTurnover({
      page,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      only_moved: onlyMoved === '1' || undefined,
    }, signal),
    [page, search, clientId, dateFrom, dateTo, onlyMoved],
  )

  const items = data?.items ?? []
  const totals = data?.totals
  const kpi = (n: number | undefined) => (totals ? num(n ?? 0) : '—')

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Товар, SKU…"
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
            onClear={() => setMany({ from: '', to: '' })}
          />
          <FilterChip
            label="Только с движением"
            active={onlyMoved === '1'}
            onClick={() => setOnlyMoved(onlyMoved === '1' ? '' : '1')}
            onClear={() => setOnlyMoved('')}
          />
          {(clientId || dateFrom || dateTo) && (
            <button className="btn ghost sm" onClick={() => setMany({ client: '', from: '', to: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <KPI label={dateFrom ? `Остаток на ${dateFrom.split('-').reverse().join('.')}` : 'Остаток на начало'} value={kpi(totals?.opening)} unit="шт" />
        <KPI
          label="Приход"
          value={kpi(totals ? totals.receipt + totals.stock_entry : undefined)}
          valueColor="var(--c-success)"
          unit="шт"
        />
        <KPI label="Отгружено" value={kpi(totals?.shipped)} valueColor="var(--c-accent)" unit="шт" />
        <KPI label="Списано" value={kpi(totals?.written_off)} valueColor="var(--c-warning)" unit="шт" />
        <KPI
          label={dateTo ? `Остаток на ${dateTo.split('-').reverse().join('.')}` : 'Остаток сейчас'}
          value={kpi(totals?.closing)}
          unit="шт"
        />
      </div>

      <Table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Клиент</th>
            <th style={{ textAlign: 'right', width: 110 }}>На начало</th>
            <th style={{ textAlign: 'right', width: 110 }}>Приход</th>
            <th style={{ textAlign: 'right', width: 110 }}>Отгружено</th>
            <th style={{ textAlign: 'right', width: 100 }}>Списано</th>
            <th style={{ textAlign: 'right', width: 110 }}>Коррект.</th>
            <th style={{ textAlign: 'right', width: 110, borderLeft: '2px solid var(--c-border)' }}>На конец</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={8} />
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={8}>
                <EmptyState title="Движений нет" sub="За выбранный период приход и расход по товарам не зафиксированы" />
              </td>
            </tr>
          ) : (
            items.map((item, i) => (
              <tr
                key={`${item.product_id}-${item.color_id}-${item.size_id}-${i}`}
                style={{ cursor: 'pointer' }}
                title="История движения остатка"
                onClick={() => setSelected(item)}
              >
                <Td>
                  <div style={{ fontWeight: 500 }}>{item.product_name ?? '—'}</div>
                  <div className="t-sub mono">
                    {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>{item.client_name ?? '—'}</Td>
                <QtyCell value={item.opening} />
                <Td className="num" style={{ color: item.receipt + item.stock_entry ? 'var(--c-success)' : 'var(--c-text-faint)', fontWeight: 500 }}>
                  {item.receipt + item.stock_entry ? `+${num(item.receipt + item.stock_entry)}` : '—'}
                  {item.stock_entry > 0 && (
                    <div className="t-sub" style={{ fontSize: 11 }}>заведено {num(item.stock_entry)}</div>
                  )}
                </Td>
                <QtyCell value={item.shipped} color="var(--c-accent)" prefix="−" />
                <QtyCell value={item.written_off} color="var(--c-warning)" prefix="−" />
                <QtyCell value={item.adjustments} color="var(--c-text-muted)" prefix={item.adjustments < 0 ? '−' : '+'} />
                <Td className="num" style={{ borderLeft: '2px solid var(--c-border)', fontWeight: 600, background: 'var(--c-bg-sunken)' }}>
                  {num(item.closing)}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />

      <PositionHistoryDrawer
        item={selected}
        dateFrom={dateFrom || undefined}
        dateTo={dateTo || undefined}
        onClose={() => setSelected(null)}
      />
    </>
  )
}
