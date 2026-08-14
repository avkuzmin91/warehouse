import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CABINET_SHIPMENT_STATUS_ORDER,
  CABINET_SHIPMENT_STATUS_LABELS,
  cabinetShipmentStatusLabel,
  cabinetShipmentStatusTone,
  getCabinetShipmentLines,
  getCabinetShipments,
} from '../../../api/cabinetApi'
import type { CabinetCargoType } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'
import { DateRange } from '../../data/DateRange'
import { FiltersBar, FilterSelect } from '../../data/FiltersBar'
import { Pagination } from '../../data/Pagination'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { Badge } from '../../primitives/Badge'
import type { BadgeTone } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { fmtDate } from '../../../utils/format'
import { CellProg } from './shared/cabinetUI'

const PAGE_SIZE = 25

const MODE_TABS = [
  { id: 'docs', label: 'По документам' },
  { id: 'items', label: 'По товарам' },
] as const

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  ...CABINET_SHIPMENT_STATUS_ORDER.map((s) => ({ value: s, label: CABINET_SHIPMENT_STATUS_LABELS[s] })),
]

const CARGO_OPTIONS = [
  { value: '', label: 'Любой груз' },
  { value: 'good', label: 'Обычная отгрузка' },
  { value: 'good_unpacked', label: 'Без упаковки' },
  { value: 'defect', label: 'Возврат брака' },
]

export function CabinetShipmentsFeature() {
  const navigate = useNavigate()
  const [mode, setMode] = useFilterParam('mode', 'docs')
  const [search, setSearch] = useFilterParam('search', '')
  const [statusFilter, setStatusFilter] = useFilterParam('status', '')
  const [cargoFilter, setCargoFilter] = useFilterParam('cargo', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

  // Debounce поиска: инпут меняется мгновенно, URL и запрос — после паузы.
  // Sync-эффект подхватывает внешнюю смену URL («Сбросить», «Назад»).
  const [searchInput, setSearchInput] = useState(search)
  useEffect(() => { setSearchInput(search) }, [search])
  useEffect(() => {
    if (searchInput === search) return
    const timer = setTimeout(() => setSearch(searchInput), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search])

  const params = {
    page,
    limit: PAGE_SIZE,
    status: statusFilter || undefined,
    cargo_type: (cargoFilter || undefined) as CabinetCargoType | undefined,
    search: search.trim() || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }

  const docs = useApi(
    (signal) => (mode === 'docs' ? getCabinetShipments(params, signal) : Promise.resolve(null)),
    [mode, page, search, statusFilter, cargoFilter, dateFrom, dateTo],
  )
  const lines = useApi(
    (signal) => (mode === 'items' ? getCabinetShipmentLines(params, signal) : Promise.resolve(null)),
    [mode, page, search, statusFilter, cargoFilter, dateFrom, dateTo],
  )

  const total = (mode === 'docs' ? docs.data?.total : lines.data?.total) ?? 0

  return (
    <ListPage
      title="Отгрузки"
      subtitle={`Всего: ${total}`}
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: searchInput ? 26 : undefined }}
              placeholder={mode === 'docs' ? 'Номер или магазин…' : 'Товар, SKU или номер…'}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            {searchInput && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearchInput(''); setSearch('') }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <DateRange
            from={dateFrom} to={dateTo}
            onFromChange={(v) => setDateFrom(v)}
            onToChange={(v) => setDateTo(v)}
            onClear={() => setMany({ from: '', to: '' })}
          />
          <FilterSelect
            label="Статус"
            value={statusFilter}
            options={STATUS_OPTIONS}
            onChange={(v) => setStatusFilter(v)}
          />
          <FilterSelect
            label="Тип груза"
            value={cargoFilter}
            options={CARGO_OPTIONS}
            onChange={(v) => setCargoFilter(v)}
          />
          {(search || statusFilter || cargoFilter || dateFrom || dateTo) && (
            <button className="btn ghost sm" onClick={() => setMany({ search: '', status: '', cargo: '', from: '', to: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
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

      {mode === 'items' ? (
        <>
          <Table>
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 130 }}>Документ</th>
                <th style={{ width: 150 }}>Магазин</th>
                <th style={{ width: 110 }}>Дата</th>
                <th style={{ width: 160 }}>Статус</th>
                <th style={{ width: 90, textAlign: 'right' }}>План</th>
                <th style={{ width: 100, textAlign: 'right' }}>Отгружено</th>
              </tr>
            </thead>
            <tbody>
              {lines.loading ? (
                <SkeletonRows rows={8} cols={7} />
              ) : lines.error ? (
                <tr><Td colSpan={7}><EmptyState title="Не удалось загрузить позиции" sub={lines.error.message} /></Td></tr>
              ) : (lines.data?.items ?? []).length === 0 ? (
                <tr><Td colSpan={7}><EmptyState title="Позиций нет" sub="Отгрузки появятся после принятия заказа в работу" /></Td></tr>
              ) : (
                (lines.data?.items ?? []).map((it, index) => (
                  <tr key={`${it.doc_id}-${index}`} onClick={() => navigate(`/cabinet/shipments/${it.doc_id}`)} style={{ cursor: 'pointer' }}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{it.product_name}</div>
                      <div className="t-sub mono">
                        {[it.product_sku, it.color_name, it.size_name].filter(Boolean).join(' · ')}
                      </div>
                    </Td>
                    <Td className="mono">{it.doc_number}</Td>
                    <Td>{it.store_name ?? '—'}</Td>
                    <Td style={{ color: 'var(--c-text-subtle)' }}>{fmtDate(it.ship_date)}</Td>
                    <Td>
                      <Badge tone={cabinetShipmentStatusTone(it.status) as BadgeTone} dot>
                        {cabinetShipmentStatusLabel(it.status, it.cargo_type)}
                      </Badge>
                    </Td>
                    <Td className="num">{it.qty.toLocaleString('ru-RU')}</Td>
                    <Td className="num">{it.shipped_qty.toLocaleString('ru-RU')}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={lines.data?.total ?? 0} onPage={setPage} />
        </>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Номер</th>
                <th>Магазин</th>
                <th style={{ width: 105 }}>Дата план</th>
                <th style={{ width: 105 }}>Дата факт</th>
                <th style={{ width: 180 }}>Статус</th>
                <th style={{ width: 250, textAlign: 'right' }}>Прогресс</th>
              </tr>
            </thead>
            <tbody>
              {docs.loading ? (
                <SkeletonRows rows={8} cols={6} />
              ) : docs.error ? (
                <tr><Td colSpan={6}><EmptyState title="Не удалось загрузить отгрузки" sub={docs.error.message} /></Td></tr>
              ) : (docs.data?.items ?? []).length === 0 ? (
                <tr><Td colSpan={6}><EmptyState title="Отгрузок нет" sub="Документы появятся после принятия заказа в работу" /></Td></tr>
              ) : (
                (docs.data?.items ?? []).map((item) => {
                  const progressQty = item.total_shipped_qty
                  const fullyShipped = item.total_qty > 0 && progressQty >= item.total_qty
                  return (
                    <tr key={item.id} onClick={() => navigate(`/cabinet/shipments/${item.id}`)} style={{ cursor: 'pointer' }}>
                      <Td>
                        <span className="mono" style={{ fontWeight: 550 }}>{item.doc_number}</span>
                        {item.cargo_type === 'defect' && (
                          <div style={{ marginTop: 3 }}><Badge tone="warning">Возврат брака</Badge></div>
                        )}
                        {item.cargo_type === 'good_unpacked' && (
                          <div style={{ marginTop: 3 }}><Badge>Без упаковки</Badge></div>
                        )}
                      </Td>
                      <Td>{item.store_names.length > 0 ? item.store_names.join(', ') : '—'}</Td>
                      <Td className="dt">{fmtDate(item.ship_date)}</Td>
                      <Td className="dt">{item.actual_ship_date ? fmtDate(item.actual_ship_date) : <span className="dash">—</span>}</Td>
                      <Td>
                        <Badge tone={cabinetShipmentStatusTone(item.status) as BadgeTone} dot>
                          {cabinetShipmentStatusLabel(item.status, item.cargo_type)}
                        </Badge>
                      </Td>
                      <Td className="num">
                        <div className="cellprog">
                          <div className="row" style={{ gap: 6 }}>
                            <span className="t-sub">отгружено</span>
                            <span style={{ fontWeight: 600 }}>{progressQty.toLocaleString('ru-RU')}</span>
                            <span className="t-sub">из {item.total_qty.toLocaleString('ru-RU')} шт</span>
                          </div>
                          {item.status !== 'cancelled' && (
                            <CellProg
                              value={progressQty}
                              max={item.total_qty}
                              color={fullyShipped ? 'var(--c-success)' : 'var(--c-accent)'}
                            />
                          )}
                        </div>
                      </Td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={docs.data?.total ?? 0} onPage={setPage} />
        </>
      )}
    </ListPage>
  )
}
