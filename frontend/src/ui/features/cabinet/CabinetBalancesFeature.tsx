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

  const items = data?.items ?? []
  const kpi = useMemo(() => ({
    totalQty: items.reduce((sum, item) => sum + item.total, 0),
    goodQty: items.reduce((sum, item) => sum + item.good, 0),
    defectQty: items.reduce((sum, item) => sum + item.defect, 0),
    onReviewQty: items.reduce((sum, item) => sum + item.on_review, 0),
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
            <KPI label="Годный" value={kpi.goodQty.toLocaleString('ru-RU')} valueColor="var(--c-success)" unit="шт" />
            <KPI label="Брак" value={kpi.defectQty.toLocaleString('ru-RU')} valueColor="var(--c-warning)" unit="шт" />
            <KPI label="На проверке" value={kpi.onReviewQty.toLocaleString('ru-RU')} valueColor="var(--c-accent)" unit="шт" />
          </div>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ textAlign: 'right', width: 90 }}>Годный</th>
                <th style={{ textAlign: 'right', width: 80 }}>Брак</th>
                <th style={{ textAlign: 'right', width: 110 }}>На проверке</th>
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
                    <Td className="num" style={{ color: item.good > 0 ? 'var(--c-success)' : undefined, fontWeight: item.good > 0 ? 500 : undefined }}>
                      {item.good.toLocaleString('ru-RU')}
                    </Td>
                    <Td className="num" style={{ color: item.defect > 0 ? 'var(--c-warning)' : undefined, fontWeight: item.defect > 0 ? 500 : undefined }}>
                      {item.defect.toLocaleString('ru-RU')}
                    </Td>
                    <Td className="num" style={{ color: item.on_review > 0 ? 'var(--c-accent)' : undefined, fontWeight: item.on_review > 0 ? 500 : undefined }}>
                      {item.on_review.toLocaleString('ru-RU')}
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
