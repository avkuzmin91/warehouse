import { Fragment } from 'react'
import { getCabinetPackingReport } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { DateRange } from '../../data/DateRange'
import { FiltersBar } from '../../data/FiltersBar'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { KPI } from '../../primitives/KPI'
import { SkeletonRows } from '../../primitives/Skeleton'
import { fmtDate } from '../../../utils/format'

export function CabinetReportsFeature() {
  const [search, setSearch] = useFilterParam('search', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [openDay, setOpenDay] = useFilterParam('day', '')
  const { setMany } = useFilterParamsActions()

  const { data, loading, error } = useApi(
    (signal) => getCabinetPackingReport({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      search: search.trim() || undefined,
    }, signal),
    [search, dateFrom, dateTo],
  )

  const days = data?.days ?? []

  return (
    <ListPage
      title="Отчёты"
      subtitle="Упаковка по дням за выбранный период (по умолчанию — последние 30 дней)"
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
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
          <DateRange
            from={dateFrom} to={dateTo}
            onFromChange={(v) => setDateFrom(v)}
            onToChange={(v) => setDateTo(v)}
            onClear={() => setMany({ from: '', to: '' })}
          />
        </FiltersBar>
      }
    >
      {error ? (
        <EmptyState title="Не удалось загрузить отчёт" sub={error.message} />
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <KPI label="Упаковано всего" value={(data?.total ?? 0).toLocaleString('ru-RU')} unit="шт" />
            <KPI label="Годный" value={(data?.total_good ?? 0).toLocaleString('ru-RU')} valueColor="var(--c-success)" unit="шт" />
            <KPI label="Брак" value={(data?.total_defect ?? 0).toLocaleString('ru-RU')} valueColor="var(--c-warning)" unit="шт" />
            <KPI label="Дней с упаковкой" value={days.length.toLocaleString('ru-RU')} />
          </div>
          <Table>
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th style={{ width: 130 }}>Дата</th>
                <th style={{ width: 100, textAlign: 'right' }}>Годный</th>
                <th style={{ width: 100, textAlign: 'right' }}>Брак</th>
                <th style={{ width: 100, textAlign: 'right' }}>Всего</th>
                <th style={{ width: 80, textAlign: 'right' }}>SKU</th>
                <th style={{ textAlign: 'right' }}>Документов</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} cols={7} />
              ) : days.length === 0 ? (
                <tr><Td colSpan={7}><EmptyState title="Данных нет" sub="За выбранный период упаковки по вашим заказам не было" /></Td></tr>
              ) : (
                days.map((day) => (
                  <Fragment key={day.packed_date}>
                    <tr
                      onClick={() => setOpenDay(openDay === day.packed_date ? '' : day.packed_date)}
                      style={{ cursor: 'pointer' }}
                    >
                      <Td>
                        <Icon name={openDay === day.packed_date ? 'chevDown' : 'chev'} size={13} style={{ color: 'var(--c-text-subtle)' }} />
                      </Td>
                      <Td style={{ fontWeight: 500 }}>{fmtDate(day.packed_date)}</Td>
                      <Td className="num" style={{ color: 'var(--c-success)' }}>{day.good.toLocaleString('ru-RU')}</Td>
                      <Td className="num" style={{ color: day.defect > 0 ? 'var(--c-warning)' : undefined }}>{day.defect.toLocaleString('ru-RU')}</Td>
                      <Td className="num" style={{ fontWeight: 600 }}>{day.total.toLocaleString('ru-RU')}</Td>
                      <Td className="num">{day.sku_count.toLocaleString('ru-RU')}</Td>
                      <Td className="num">{day.doc_count.toLocaleString('ru-RU')}</Td>
                    </tr>
                    {openDay === day.packed_date && day.rows.map((row, index) => (
                      <tr key={`${day.packed_date}-${index}`} style={{ background: 'var(--c-bg-sunken)' }}>
                        <Td />
                        <Td colSpan={1}>
                          <div style={{ fontSize: 13 }}>{row.product_name ?? '—'}</div>
                          <div className="t-sub mono">{row.product_sku ?? ''}</div>
                        </Td>
                        <Td className="num">{row.good.toLocaleString('ru-RU')}</Td>
                        <Td className="num" style={{ color: row.defect > 0 ? 'var(--c-warning)' : undefined }}>{row.defect.toLocaleString('ru-RU')}</Td>
                        <Td className="num">{row.total.toLocaleString('ru-RU')}</Td>
                        <Td colSpan={2} />
                      </tr>
                    ))}
                  </Fragment>
                ))
              )}
            </tbody>
          </Table>
        </>
      )}
    </ListPage>
  )
}
