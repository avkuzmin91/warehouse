import { getCabinetBalances, getCabinetBalancesSummary } from '../../../api/cabinetApi'
import { INV_OP_LABELS } from '../../../api/balancesApi'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, usePageParam } from '../../../hooks/useFilterParams'
import { FiltersBar, FilterChip } from '../../data/FiltersBar'
import { Pagination } from '../../data/Pagination'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { KPI } from '../../primitives/KPI'
import { SkeletonRows } from '../../primitives/Skeleton'
import { BucketCell } from '../shared/BucketCell'

const PAGE_SIZE = 50

export function CabinetBalancesFeature() {
  const [search, setSearch] = useFilterParam('search', '')
  const [stockMode, setStockMode] = useFilterParam('stock', 'positive')
  const [defectMode, setDefectMode] = useFilterParam('defect', '')
  const [page, setPage] = usePageParam()
  const onlyPositive = stockMode !== 'all'
  const hasDefect = defectMode === '1'

  const { data, loading, error } = useApi(
    (signal) => getCabinetBalances({
      page,
      limit: PAGE_SIZE,
      search: search.trim() || undefined,
      only_positive: onlyPositive ? undefined : false,
      has_defect: hasDefect || undefined,
    }, signal),
    [page, search, onlyPositive, hasDefect],
  )
  const summaryRes = useApi(
    (signal) => getCabinetBalancesSummary({
      search: search.trim() || undefined,
      has_defect: hasDefect || undefined,
    }, signal),
    [search, hasDefect],
  )

  const items = data?.items ?? []
  const summary = summaryRes.data
  const kpiVal = (n: number | undefined) => (summary ? (n ?? 0).toLocaleString('ru-RU') : '—')
  const defectQty = summary
    ? summary.storage_defect + summary.packing_defect + summary.ready_defect
    : undefined

  return (
    <ListPage
      title="Остатки"
      subtitle={loading ? 'Загрузка…' : `${data?.total ?? 0} позиций`}
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 240, paddingRight: search ? 26 : undefined }}
              placeholder="Товар или SKU…"
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
          <FilterChip
            label="Только с остатком"
            active={onlyPositive}
            onClick={() => setStockMode(onlyPositive ? 'all' : 'positive')}
            onClear={() => setStockMode('all')}
          />
          <FilterChip
            label="Есть брак"
            active={hasDefect}
            onClick={() => setDefectMode(hasDefect ? '' : '1')}
            onClear={() => setDefectMode('')}
          />
        </FiltersBar>
      }
    >
      {error ? (
        <EmptyState title="Не удалось загрузить остатки" sub={error.message} />
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(6, 1fr)' }}>
            <KPI label="Всего единиц" value={kpiVal(summary?.total)} unit="шт" />
            <KPI label={INV_OP_LABELS.intake} value={kpiVal(summary?.intake)} unit="шт" />
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
              onClick={() => setDefectMode(hasDefect ? '' : '1')}
            />
          </div>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ textAlign: 'right', width: 110 }}>{INV_OP_LABELS.intake}</th>
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
                <tr><Td colSpan={6}><EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений" /></Td></tr>
              ) : (
                items.map((item, index) => (
                  <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${index}`}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                      <div className="t-sub mono">
                        {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                      </div>
                    </Td>
                    <Td className="num">
                      {item.intake > 0
                        ? <span style={{ fontWeight: 500 }}>{item.intake.toLocaleString('ru-RU')}</span>
                        : <span style={{ color: 'var(--c-text-faint)' }}>0</span>}
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </ListPage>
  )
}
