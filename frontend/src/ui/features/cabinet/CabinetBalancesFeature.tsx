import { getCabinetBalances, getCabinetBalancesSummary, getCabinetWriteOffs } from '../../../api/cabinetApi'
import { INV_OP_LABELS, INV_QUALITY_LABELS, WRITEOFF_REASON_LABELS } from '../../../api/balancesApi'
import type { InvQuality, WriteOffReason } from '../../../api/balancesApi'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, usePageParam } from '../../../hooks/useFilterParams'
import { FiltersBar, FilterChip } from '../../data/FiltersBar'
import { Pagination } from '../../data/Pagination'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { Card, CardHead } from '../../primitives/Card'
import { Badge } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { KPI } from '../../primitives/KPI'
import { SkeletonRows } from '../../primitives/Skeleton'
import { BucketCell } from '../shared/BucketCell'

const PAGE_SIZE = 50
const WRITEOFFS_LIMIT = 20

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

  const writeOffsRes = useApi((signal) => getCabinetWriteOffs({ limit: WRITEOFFS_LIMIT }, signal), [])
  const writeOffs = writeOffsRes.data?.items ?? []

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
          <div className="zone-strip" style={{ marginBottom: 18 }}>
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
                <th style={{ width: 150 }}>Распределение</th>
                <th style={{ textAlign: 'right', width: 100 }}>{INV_OP_LABELS.intake}</th>
                <th style={{ textAlign: 'right', width: 120 }}>{INV_OP_LABELS.storage}</th>
                <th style={{ textAlign: 'right', width: 120 }}>{INV_OP_LABELS.packing}</th>
                <th style={{ textAlign: 'right', width: 130 }}>{INV_OP_LABELS.ready}</th>
                <th className="total-col" style={{ textAlign: 'right', width: 95 }}>Всего</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={7} />
              ) : items.length === 0 ? (
                <tr><Td colSpan={7}><EmptyState title="Остатков нет" sub="Данные появятся после завершения поступлений" /></Td></tr>
              ) : (
                items.map((item, index) => {
                  const stor = item.storage_good + item.storage_defect
                  const pack = item.packing_good + item.packing_defect
                  const ready = item.ready_good + item.ready_defect
                  const sum = Math.max(1, stor + pack + ready)
                  return (
                    <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${index}`}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                        <div className="t-sub mono">
                          {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td>
                        <div
                          className="distbar"
                          title={`хранение ${stor.toLocaleString('ru-RU')} · упаковка ${pack.toLocaleString('ru-RU')} · готово ${ready.toLocaleString('ru-RU')}`}
                        >
                          <i style={{ width: `${(stor / sum) * 100}%`, background: 'var(--c-accent)', opacity: 0.75 }} />
                          <i style={{ width: `${(pack / sum) * 100}%`, background: 'var(--c-info)', opacity: 0.75 }} />
                          <i style={{ width: `${(ready / sum) * 100}%`, background: 'var(--c-success)', opacity: 0.8 }} />
                        </div>
                      </Td>
                      <Td className="num">
                        {item.intake > 0
                          ? <span style={{ fontWeight: 500 }}>{item.intake.toLocaleString('ru-RU')}</span>
                          : <span className="dash">0</span>}
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
                      <Td className="num total-col">{item.total.toLocaleString('ru-RU')}</Td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </Table>
          <div className="row mt-12" style={{ gap: 12, color: 'var(--c-text-subtle)', fontSize: 12 }}>
            <span className="row gap-4"><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-accent)', opacity: 0.75 }} />хранение</span>
            <span className="row gap-4"><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-info)', opacity: 0.75 }} />упаковка</span>
            <span className="row gap-4"><i style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--c-success)', opacity: 0.8 }} />готово к отгрузке</span>
            <span style={{ color: 'var(--c-warning)' }}>+n брак — брак в зоне</span>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPage={setPage} />

          {writeOffs.length > 0 && (
            <Card style={{ marginTop: 20 }}>
              <CardHead>
                <Icon name="alert" size={15} style={{ color: 'var(--c-warning)' }} />
                <span className="card-head-title">Списания</span>
                <Badge tone="warning" style={{ marginLeft: 6 }}>{writeOffsRes.data?.total ?? writeOffs.length}</Badge>
              </CardHead>
              <Table>
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Дата</th>
                    <th>Товар</th>
                    <th style={{ width: 100 }}>Качество</th>
                    <th style={{ textAlign: 'right', width: 90 }}>Кол-во</th>
                    <th style={{ width: 160 }}>Причина</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {writeOffs.map((w) => (
                    <tr key={w.id}>
                      <Td className="t-sub mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {new Date(w.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{w.product_name ?? '—'}</div>
                        <div className="t-sub mono">
                          {[w.product_sku, w.color_name, w.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={w.quality === 'defect' ? 'warning' : 'success'}>
                          {INV_QUALITY_LABELS[w.quality as InvQuality] ?? w.quality}
                        </Badge>
                      </Td>
                      <Td className="num" style={{ fontWeight: 600 }}>{w.qty.toLocaleString('ru-RU')}</Td>
                      <Td style={{ fontSize: 13 }}>
                        {w.reason ? WRITEOFF_REASON_LABELS[w.reason as WriteOffReason] ?? w.reason : '—'}
                      </Td>
                      <Td style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{w.comment ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </ListPage>
  )
}
