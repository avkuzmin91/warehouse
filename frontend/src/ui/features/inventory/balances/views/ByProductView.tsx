import { useState, useEffect, useCallback } from 'react'
import { getBalances, getBalancesSummary, INV_OP_LABELS } from '../../../../../api/balancesApi'
import type { BalanceItem, BalanceSummary } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { Table, Td } from '../../../../data/Table'
import { Pagination } from '../../../../data/Pagination'
import { FiltersBar, FilterChip, FilterCombobox } from '../../../../data/FiltersBar'
import { KPI } from '../../../../primitives/KPI'
import { Icon } from '../../../../primitives/Icon'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'
import { BucketCell } from '../../../shared/BucketCell'

const PAGE_SIZE = 50

export function ByProductView() {
  const [items, setItems] = useState<BalanceItem[]>([])
  const [summary, setSummary] = useState<BalanceSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [onlyPositive, setOnlyPositive] = useState(true)
  const [hasDefect, setHasDefect] = useState(false)
  const { clients } = useLookups()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, sum] = await Promise.all([
        getBalances({
          page,
          limit: PAGE_SIZE,
          search: search || undefined,
          client_id: clientId || undefined,
          only_positive: onlyPositive ? undefined : false,
          has_defect: hasDefect || undefined,
        }),
        getBalancesSummary({
          search: search || undefined,
          client_id: clientId || undefined,
          has_defect: hasDefect || undefined,
        }),
      ])
      setItems(res.items)
      setTotal(res.total)
      setSummary(sum)
    } finally {
      setLoading(false)
    }
  }, [page, search, clientId, onlyPositive, hasDefect])

  useEffect(() => { load() }, [load])

  const kpiVal = (n: number | undefined) => (summary ? (n ?? 0).toLocaleString('ru-RU') : '—')
  const defectQty = summary
    ? summary.storage_defect + summary.packing_defect + summary.ready_defect
    : undefined

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Товар, SKU, клиент…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearch(''); setPage(1) }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => { setClientId(v); setPage(1) }}
            placeholder="Поиск клиента…"
          />
          <FilterChip
            label="Только с остатком"
            active={onlyPositive}
            onClick={() => { setOnlyPositive(!onlyPositive); setPage(1) }}
            onClear={() => { setOnlyPositive(false); setPage(1) }}
          />
          <FilterChip
            label="Есть брак"
            active={hasDefect}
            onClick={() => { setHasDefect(!hasDefect); setPage(1) }}
            onClear={() => { setHasDefect(false); setPage(1) }}
          />
          {(clientId) && (
            <button className="btn ghost sm" onClick={() => { setClientId(''); setPage(1) }}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          <button
            className="btn ghost sm icon"
            title="Обновить"
            onClick={() => load()}
          >
            <Icon name="refresh" size={14} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          </button>
        </FiltersBar>
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <KPI label="Всего единиц" value={kpiVal(summary?.total)} unit="шт" />
        <KPI
          label={INV_OP_LABELS.storage}
          value={kpiVal(summary ? summary.storage_good + summary.storage_defect : undefined)}
          valueColor="var(--c-accent)"
          unit="шт"
        />
        <KPI
          label={INV_OP_LABELS.packing}
          value={kpiVal(summary ? summary.packing_good + summary.packing_defect : undefined)}
          valueColor="var(--c-info)"
          unit="шт"
        />
        <KPI
          label={INV_OP_LABELS.ready}
          value={kpiVal(summary ? summary.ready_good + summary.ready_defect : undefined)}
          valueColor="var(--c-success)"
          unit="шт"
        />
        <KPI
          label="Брак (из них)"
          value={kpiVal(defectQty)}
          valueColor="var(--c-warning)"
          unit="шт"
          active={hasDefect}
          onClick={() => { setHasDefect(!hasDefect); setPage(1) }}
        />
      </div>

      <Table>
        <thead>
          <tr>
            <th>Товар</th>
            <th>Клиент</th>
            <th style={{ textAlign: 'right', width: 130 }}>{INV_OP_LABELS.storage}</th>
            <th style={{ textAlign: 'right', width: 130 }}>{INV_OP_LABELS.packing}</th>
            <th style={{ textAlign: 'right', width: 140 }}>{INV_OP_LABELS.ready}</th>
            <th style={{ textAlign: 'right', width: 90, borderLeft: '2px solid var(--c-border)' }}>Всего</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={6} />
          ) : items.length === 0 ? (
            <tr><td colSpan={6}><EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений" /></td></tr>
          ) : (
            items.map((item, i) => (
              <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${i}`}>
                <Td>
                  <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                  <div className="t-sub mono">
                    {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>
                  {item.client_name ?? '—'}
                </Td>
                <Td className="num">
                  <BucketCell good={item.storage_good} defect={item.storage_defect} accent="var(--c-accent)" />
                </Td>
                <Td className="num">
                  <BucketCell good={item.packing_good} defect={item.packing_defect} accent="var(--c-info)" />
                </Td>
                <Td className="num">
                  <BucketCell good={item.ready_good} defect={item.ready_defect} accent="var(--c-success)" />
                </Td>
                <Td className="num" style={{ borderLeft: '2px solid var(--c-border)', fontWeight: 600, background: 'var(--c-bg-sunken)', color: 'var(--c-text)' }}>
                  {item.total.toLocaleString('ru-RU')}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </>
  )
}
