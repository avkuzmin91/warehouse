import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CABINET_RECEIPT_STATUS_LABELS,
  CABINET_RECEIPT_STATUS_ORDER,
  cabinetReceiptStatusTone,
  getCabinetReceiptLines,
  getCabinetReceipts,
} from '../../../api/cabinetApi'
import type { CabinetReceiptListItem } from '../../../api/cabinetApi'
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
  ...CABINET_RECEIPT_STATUS_ORDER.map((s) => ({ value: s, label: CABINET_RECEIPT_STATUS_LABELS[s] })),
]

function hasShortfall(item: CabinetReceiptListItem): boolean {
  return item.status === 'done' && item.total_accepted_qty < item.total_planned
}

export function CabinetReceiptsFeature() {
  const navigate = useNavigate()
  const [mode, setMode] = useFilterParam('mode', 'docs')
  const [search, setSearch] = useFilterParam('search', '')
  const [statusFilter, setStatusFilter] = useFilterParam('status', '')
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
    search: search.trim() || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }

  const docs = useApi(
    (signal) => (mode === 'docs' ? getCabinetReceipts(params, signal) : Promise.resolve(null)),
    [mode, page, search, statusFilter, dateFrom, dateTo],
  )
  const lines = useApi(
    (signal) => (mode === 'items' ? getCabinetReceiptLines(params, signal) : Promise.resolve(null)),
    [mode, page, search, statusFilter, dateFrom, dateTo],
  )

  const total = (mode === 'docs' ? docs.data?.total : lines.data?.total) ?? 0

  return (
    <ListPage
      title="Поступления"
      subtitle={`Всего: ${total}`}
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: searchInput ? 26 : undefined }}
              placeholder={mode === 'docs' ? 'Номер документа…' : 'Товар, SKU или номер…'}
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
          {(statusFilter || dateFrom || dateTo) && (
            <button className="btn ghost sm" onClick={() => setMany({ status: '', from: '', to: '' })}>
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
                <th style={{ width: 110 }}>Дата</th>
                <th style={{ width: 140 }}>Статус</th>
                <th style={{ width: 90, textAlign: 'right' }}>План</th>
                <th style={{ width: 90, textAlign: 'right' }}>Принято</th>
              </tr>
            </thead>
            <tbody>
              {lines.loading ? (
                <SkeletonRows rows={8} cols={6} />
              ) : lines.error ? (
                <tr><Td colSpan={6}><EmptyState title="Не удалось загрузить позиции" sub={lines.error.message} /></Td></tr>
              ) : (lines.data?.items ?? []).length === 0 ? (
                <tr><Td colSpan={6}><EmptyState title="Позиций нет" sub="Поступления появятся после планирования поставки" /></Td></tr>
              ) : (
                (lines.data?.items ?? []).map((it, index) => (
                  <tr key={`${it.doc_id}-${index}`} onClick={() => navigate(`/cabinet/receipts/${it.doc_id}`)} style={{ cursor: 'pointer' }}>
                    <Td>
                      <div style={{ fontWeight: 500 }}>{it.product_name}</div>
                      <div className="t-sub mono">
                        {[it.product_sku, it.color_name, it.size_name].filter(Boolean).join(' · ')}
                      </div>
                    </Td>
                    <Td className="mono">{it.doc_number}</Td>
                    <Td style={{ color: 'var(--c-text-subtle)' }}>{fmtDate(it.actual_arrival_date ?? it.arrival_date)}</Td>
                    <Td>
                      <Badge tone={cabinetReceiptStatusTone(it.status) as BadgeTone} dot>
                        {CABINET_RECEIPT_STATUS_LABELS[it.status]}
                      </Badge>
                    </Td>
                    <Td className="num">{it.planned_qty.toLocaleString('ru-RU')}</Td>
                    <Td className="num">{it.accepted_qty != null ? it.accepted_qty.toLocaleString('ru-RU') : '—'}</Td>
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
                <th style={{ width: 140 }}>Номер</th>
                <th style={{ width: 110 }}>Дата план</th>
                <th style={{ width: 110 }}>Дата факт</th>
                <th style={{ width: 160 }}>Статус</th>
                <th style={{ width: 80, textAlign: 'right' }}>SKU</th>
                <th style={{ width: 220, textAlign: 'right' }}>Принято / план</th>
              </tr>
            </thead>
            <tbody>
              {docs.loading ? (
                <SkeletonRows rows={8} cols={6} />
              ) : docs.error ? (
                <tr><Td colSpan={6}><EmptyState title="Не удалось загрузить поступления" sub={docs.error.message} /></Td></tr>
              ) : (docs.data?.items ?? []).length === 0 ? (
                <tr><Td colSpan={6}><EmptyState title="Поступлений нет" sub="Документы появятся после планирования поставки" /></Td></tr>
              ) : (
                (docs.data?.items ?? []).map((item) => {
                  const shortfall = hasShortfall(item)
                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/cabinet/receipts/${item.id}`)}
                      style={{
                        cursor: 'pointer',
                        ...(shortfall ? { background: 'color-mix(in oklab, var(--c-warning) 6%, transparent)' } : {}),
                      }}
                    >
                      <Td><span className="mono" style={{ fontWeight: 550 }}>{item.doc_number}</span></Td>
                      <Td className="dt">{fmtDate(item.arrival_date)}</Td>
                      <Td className="dt">{item.actual_arrival_date ? fmtDate(item.actual_arrival_date) : <span className="dash">—</span>}</Td>
                      <Td>
                        <Badge tone={cabinetReceiptStatusTone(item.status) as BadgeTone} dot>
                          {CABINET_RECEIPT_STATUS_LABELS[item.status]}
                        </Badge>
                      </Td>
                      <Td className="num">{item.sku_count}</Td>
                      <Td className="num">
                        <div className="cellprog">
                          <div className="row" style={{ gap: 6 }}>
                            <span style={{ fontWeight: 600, color: shortfall ? 'var(--c-warning)' : undefined }}>
                              {item.total_accepted_qty.toLocaleString('ru-RU')}
                            </span>
                            <span className="t-sub">/ {item.total_planned.toLocaleString('ru-RU')}</span>
                            {shortfall && (
                              <span className="short-flag">
                                <Icon name="alert" size={11} />−{(item.total_planned - item.total_accepted_qty).toLocaleString('ru-RU')}
                              </span>
                            )}
                          </div>
                          {item.status !== 'cancelled' && (
                            <CellProg
                              value={item.total_accepted_qty}
                              max={item.total_planned}
                              color={shortfall ? 'var(--c-warning)' : item.status === 'done' ? 'var(--c-success)' : 'var(--c-info)'}
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
