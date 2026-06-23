import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPackingProductivity } from '../../../api/shipmentsApi'
import type { PackingProductivityDay } from '../../../api/shipmentsApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { FiltersBar, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Icon } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtYmdAsDmy } from '../../../utils/format'
import { useLookups } from '../../../hooks/useLookups'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { MOSCOW_TZ, moscowTodayYmd, parseMoscow } from '../../../utils/format'

const today = () => moscowTodayYmd()

const weekAgo = () => {
  const [y, m, d] = moscowTodayYmd().split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 6)).toISOString().slice(0, 10)
}

function weekdayShort(ymd: string): string {
  const d = parseMoscow(ymd)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: MOSCOW_TZ })
}

export function PackingProductivityView() {
  const navigate = useNavigate()
  const defFrom = weekAgo()
  const defTo = today()

  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', defFrom)
  const [dateTo, setDateTo] = useFilterParam('to', defTo)
  const { setMany } = useFilterParamsActions()
  const [reloadTick, setReloadTick] = useState(0)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  const { clients } = useLookups()

  const { data, loading } = useApi(
    (signal) => getPackingProductivity({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      client_id: clientId || undefined,
      search: search.trim() || undefined,
    }, signal),
    [search, clientId, dateFrom, dateTo, reloadTick],
  )

  const days = data?.days ?? []
  const isDayOpen = (day: PackingProductivityDay, idx: number) =>
    toggled[day.packed_date] ?? idx === 0

  return (
    <ListPage
      title="Производительность упаковки"
      subtitle={data
        ? `За период: ${data.total.toLocaleString('ru-RU')} шт (годный ${data.total_good.toLocaleString('ru-RU')} · брак ${data.total_defect.toLocaleString('ru-RU')})`
        : undefined}
      actions={
        <button className="btn ghost" onClick={() => navigate('/inventory/packing')}>
          <Icon name="arrowLeft" size={14} />Задачи упаковки
        </button>
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="SKU или название товара…"
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
            onClear={() => setMany({ from: defFrom, to: defTo })}
          />
          <button
            className="btn ghost sm icon"
            title="Обновить"
            onClick={() => setReloadTick((t) => t + 1)}
          >
            <Icon name="refresh" size={14} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          </button>
        </FiltersBar>
      }
    >
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--c-border)', borderTopColor: 'var(--c-accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        </div>
      ) : days.length === 0 ? (
        <EmptyState
          title="За период записей упаковки нет"
          sub="Данные появляются после внесения упаковки в карточках отгрузок"
        />
      ) : (
        days.map((day, idx) => {
          const open = isDayOpen(day, idx)
          return (
            <div key={day.packed_date} className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
              <button
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
                  font: 'inherit', textAlign: 'left',
                }}
                onClick={() => setToggled((p) => ({ ...p, [day.packed_date]: !open }))}
              >
                <Icon name="chev" size={13} style={{ color: 'var(--c-text-subtle)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                <span className="mono" style={{ fontWeight: 600, fontSize: 13.5 }}>{fmtYmdAsDmy(day.packed_date)}</span>
                <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>{weekdayShort(day.packed_date)}</span>
                <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                  {day.doc_count} отгр. · {day.sku_count} SKU
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: 'var(--c-success)' }}>годный <b>{day.good.toLocaleString('ru-RU')}</b></span>
                  <span style={{ color: day.defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>брак <b>{day.defect.toLocaleString('ru-RU')}</b></span>
                  <span style={{ color: 'var(--c-text)' }}>всего <b>{day.total.toLocaleString('ru-RU')}</b></span>
                </span>
              </button>
              {open && (
                <Table>
                  <thead>
                    <tr>
                      <th style={{ width: 160 }}>SKU</th>
                      <th>Товар</th>
                      <th>Клиент</th>
                      <th style={{ textAlign: 'right', width: 90 }}>Годный</th>
                      <th style={{ textAlign: 'right', width: 90 }}>Брак</th>
                      <th style={{ textAlign: 'right', width: 90 }}>Всего</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.rows.map((row) => (
                      <tr key={`${day.packed_date}|${row.client_id ?? ''}|${row.product_id}`}>
                        <Td className="mono">{row.product_sku ?? '—'}</Td>
                        <Td>{row.product_name ?? '—'}</Td>
                        <Td className="t-sub">{row.client_name ?? '—'}</Td>
                        <Td className="num" style={{ color: 'var(--c-success)' }}>{row.good.toLocaleString('ru-RU')}</Td>
                        <Td className="num" style={{ color: row.defect > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>{row.defect.toLocaleString('ru-RU')}</Td>
                        <Td className="num" style={{ fontWeight: 600 }}>{row.total.toLocaleString('ru-RU')}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          )
        })
      )}
    </ListPage>
  )
}
