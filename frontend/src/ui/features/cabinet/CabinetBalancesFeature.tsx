import { useMemo } from 'react'
import { getCabinetBalances } from '../../../api/cabinetApi'
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

  const items = useMemo(() => data?.items ?? [], [data])
  const kpi = useMemo(() => ({
    totalQty: items.reduce((sum, item) => sum + item.total, 0),
    storageQty: items.reduce((sum, item) => sum + item.storage_good + item.storage_defect, 0),
    readyQty: items.reduce((sum, item) => sum + item.ready_good + item.ready_defect, 0),
    defectQty: items.reduce((sum, item) => sum + item.storage_defect + item.packing_defect + item.ready_defect, 0),
  }), [items])

  return (
    <ListPage
      title="Мои остатки"
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
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <KPI label="Показано единиц" value={kpi.totalQty.toLocaleString('ru-RU')} unit="шт" />
            <KPI label="На хранении" value={kpi.storageQty.toLocaleString('ru-RU')} valueColor="var(--c-success)" unit="шт" />
            <KPI label="Готов к отгрузке" value={kpi.readyQty.toLocaleString('ru-RU')} valueColor="var(--c-accent)" unit="шт" />
            <KPI label="Брак" value={kpi.defectQty.toLocaleString('ru-RU')} valueColor="var(--c-warning)" unit="шт" />
          </div>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ textAlign: 'right', width: 130 }}>На хранении</th>
                <th style={{ textAlign: 'right', width: 130 }}>На упаковке</th>
                <th style={{ textAlign: 'right', width: 140 }}>Готов к отгрузке</th>
                <th style={{ textAlign: 'right', width: 90, borderLeft: '2px solid var(--c-border)' }}>Всего</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={5} />
              ) : items.length === 0 ? (
                <tr><Td colSpan={5}><EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений" /></Td></tr>
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
                      <BucketCell good={item.storage_good} defect={item.storage_defect} accent="var(--c-success)" />
                    </Td>
                    <Td className="num">
                      <BucketCell good={item.packing_good} defect={item.packing_defect} accent="var(--c-info, #3b82f6)" />
                    </Td>
                    <Td className="num">
                      <BucketCell good={item.ready_good} defect={item.ready_defect} accent="var(--c-accent)" />
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
