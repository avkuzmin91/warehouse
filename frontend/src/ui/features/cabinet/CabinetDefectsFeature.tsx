import { useNavigate } from 'react-router-dom'
import {
  cabinetShipmentStatusLabel,
  cabinetShipmentStatusTone,
  getCabinetBalances,
  getCabinetShipments,
} from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, usePageParam } from '../../../hooks/useFilterParams'
import { FiltersBar } from '../../data/FiltersBar'
import { Pagination } from '../../data/Pagination'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { fmtDate } from '../../../utils/format'

const PAGE_SIZE = 25

const MODE_TABS = [
  { id: 'stock', label: 'Остатки брака' },
  { id: 'returns', label: 'Возвраты' },
] as const

export function CabinetDefectsFeature() {
  const navigate = useNavigate()
  const [mode, setMode] = useFilterParam('mode', 'stock')
  const [search, setSearch] = useFilterParam('search', '')
  const [page, setPage] = usePageParam()

  const stock = useApi(
    (signal) => (mode === 'stock'
      ? getCabinetBalances({ page, limit: PAGE_SIZE, search: search.trim() || undefined, has_defect: true }, signal)
      : Promise.resolve(null)),
    [mode, page, search],
  )
  const returns = useApi(
    (signal) => (mode === 'returns'
      ? getCabinetShipments({ page, limit: PAGE_SIZE, search: search.trim() || undefined, cargo_type: 'defect' }, signal)
      : Promise.resolve(null)),
    [mode, page, search],
  )

  const total = (mode === 'stock' ? stock.data?.total : returns.data?.total) ?? 0

  return (
    <ListPage
      title="Брак"
      subtitle={`Всего: ${total}`}
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 240, paddingRight: search ? 26 : undefined }}
              placeholder={mode === 'stock' ? 'Товар или SKU…' : 'Номер или магазин…'}
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
        </FiltersBar>
      }
    >
      <div className="tabs" style={{ marginBottom: 14 }}>
        {MODE_TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${mode === t.id ? ' active' : ''}`}
            onClick={() => setMode(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'returns' ? (
        <>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Номер</th>
                <th>Магазин</th>
                <th style={{ width: 110 }}>Дата план</th>
                <th style={{ width: 110 }}>Дата факт</th>
                <th style={{ width: 170 }}>Статус</th>
                <th style={{ width: 90, textAlign: 'right' }}>Кол-во</th>
              </tr>
            </thead>
            <tbody>
              {returns.loading ? (
                <SkeletonRows rows={6} cols={6} />
              ) : returns.error ? (
                <tr><Td colSpan={6}><EmptyState title="Не удалось загрузить возвраты" sub={returns.error.message} /></Td></tr>
              ) : (returns.data?.items ?? []).length === 0 ? (
                <tr><Td colSpan={6}><EmptyState title="Возвратов нет" sub="Здесь появятся отгрузки брака в ваш адрес" /></Td></tr>
              ) : (
                (returns.data?.items ?? []).map((item) => (
                  <tr key={item.id} onClick={() => navigate(`/cabinet/shipments/${item.id}`)} style={{ cursor: 'pointer' }}>
                    <Td><span className="mono" style={{ fontWeight: 500 }}>{item.doc_number}</span></Td>
                    <Td>{item.store_names.length > 0 ? item.store_names.join(', ') : '—'}</Td>
                    <Td style={{ color: 'var(--c-text-subtle)' }}>{fmtDate(item.ship_date)}</Td>
                    <Td style={{ color: 'var(--c-text-subtle)' }}>{fmtDate(item.actual_ship_date)}</Td>
                    <Td>
                      <Badge tone={cabinetShipmentStatusTone(item.status) as BadgeTone} dot>
                        {cabinetShipmentStatusLabel(item.status, item.cargo_type)}
                      </Badge>
                    </Td>
                    <Td className="num">{item.total_qty.toLocaleString('ru-RU')}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={returns.data?.total ?? 0} onPage={setPage} />
        </>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ textAlign: 'right', width: 120 }}>На хранении</th>
                <th style={{ textAlign: 'right', width: 120 }}>На упаковке</th>
                <th style={{ textAlign: 'right', width: 140 }}>Готов к отгрузке</th>
                <th style={{ textAlign: 'right', width: 110, borderLeft: '2px solid var(--c-border)' }}>Итого брак</th>
              </tr>
            </thead>
            <tbody>
              {stock.loading ? (
                <SkeletonRows rows={6} cols={5} />
              ) : stock.error ? (
                <tr><Td colSpan={5}><EmptyState title="Не удалось загрузить брак" sub={stock.error.message} /></Td></tr>
              ) : (stock.data?.items ?? []).length === 0 ? (
                <tr><Td colSpan={5}><EmptyState title="Брака нет" sub="По вашим товарам брак не зафиксирован" /></Td></tr>
              ) : (
                (stock.data?.items ?? []).map((item, index) => {
                  const defectTotal = item.storage_defect + item.packing_defect + item.ready_defect
                  return (
                    <tr key={`${item.product_id}-${item.color_id}-${item.size_id}-${index}`}>
                      <Td>
                        <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                        <div className="t-sub mono">
                          {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                        </div>
                      </Td>
                      <Td className="num">{item.storage_defect.toLocaleString('ru-RU')}</Td>
                      <Td className="num">{item.packing_defect.toLocaleString('ru-RU')}</Td>
                      <Td className="num">{item.ready_defect.toLocaleString('ru-RU')}</Td>
                      <Td className="num" style={{ borderLeft: '2px solid var(--c-border)', fontWeight: 600, color: 'var(--c-warning)' }}>
                        {defectTotal.toLocaleString('ru-RU')}
                      </Td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={stock.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </ListPage>
  )
}
