import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackNav } from '../../../hooks/useBackNav'
import { getPackingProductivity } from '../../../api/shipmentsApi'
import type { PackingProductivityDay } from '../../../api/shipmentsApi'
import { ListPage } from '../../layouts/ListPage'
import { Table, Td } from '../../data/Table'
import { FiltersBar, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Icon } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtYmdAsDmy, formatMoneyKopecks } from '../../../utils/format'
import { useLookups } from '../../../hooks/useLookups'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { MOSCOW_TZ, moscowTodayYmd, parseMoscow } from '../../../utils/format'
import { MovePackDateDrawer } from './MovePackDateDrawer'
import { canMovePackDate } from '../../../utils/access'
import type { PackingProductivityRow } from '../../../api/shipmentsApi'

// table-layout: fixed фиксирует ширины колонок одинаково для всех дат-групп
// (иначе «Товар»/«Клиент» считаются по контенту каждой таблицы и «прыгают»);
// длинные значения в этих колонках обрезаем многоточием.
const ELLIP = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

// Вертикальный разделитель групп колонок — общий для thead, строк-итогов и
// товарных строк, чтобы линии шли насквозь (сквозные столбцы).
const BORDER = '1px solid var(--c-border)'

type EarnMetrics = { good: number; defect: number; good_earn_kop: number; defect_earn_kop: number; earn_kop: number }
type QtyMetrics = { good: number; defect: number; total: number }

/** Числовые ячейки режима «с заработком»: упаковка (шт/₽) · брак (шт/₽) · бар · итого.
 *  Один набор для строки-итога дня и для товарных строк — порядок колонок сквозной. */
function EarnCells({ m }: { m: EarnMetrics }) {
  return (
    <>
      <Td className="num" style={{ color: m.good > 0 ? 'var(--c-success)' : 'var(--c-text-faint)', borderLeft: BORDER }}>{m.good.toLocaleString('ru-RU')}</Td>
      <Td className="num" style={{ fontWeight: 600, color: m.good_earn_kop > 0 ? 'var(--c-success)' : 'var(--c-text-faint)' }}>{formatMoneyKopecks(m.good_earn_kop)}</Td>
      <Td className="num" style={{ color: m.defect > 0 ? 'var(--c-warning)' : 'var(--c-text-faint)', borderLeft: BORDER }}>{m.defect.toLocaleString('ru-RU')}</Td>
      <Td className="num" style={{ fontWeight: 600, color: m.defect_earn_kop > 0 ? 'var(--c-warning)' : 'var(--c-text-faint)' }}>{formatMoneyKopecks(m.defect_earn_kop)}</Td>
      <Td style={{ borderLeft: BORDER }}>
        <span style={{ display: 'flex', justifyContent: 'center' }}>
          <SplitBar good={m.good_earn_kop} defect={m.defect_earn_kop} total={m.earn_kop} width={56} />
        </span>
      </Td>
      <Td className="num" style={{ fontWeight: 700, borderLeft: BORDER }}>{formatMoneyKopecks(m.earn_kop)}</Td>
    </>
  )
}

/** Числовые ячейки режима без цен: годный · брак · всего (штуки). */
function QtyCells({ m }: { m: QtyMetrics }) {
  return (
    <>
      <Td className="num" style={{ color: m.good > 0 ? 'var(--c-success)' : 'var(--c-text-faint)', borderLeft: BORDER }}>{m.good.toLocaleString('ru-RU')}</Td>
      <Td className="num" style={{ color: m.defect > 0 ? 'var(--c-warning)' : 'var(--c-text-faint)' }}>{m.defect.toLocaleString('ru-RU')}</Td>
      <Td className="num" style={{ fontWeight: 600 }}>{m.total.toLocaleString('ru-RU')}</Td>
    </>
  )
}

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
  const goBack = useBackNav('/inventory/packing')
  const defFrom = weekAgo()
  const defTo = today()

  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', defFrom)
  const [dateTo, setDateTo] = useFilterParam('to', defTo)
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

  const [reloadTick, setReloadTick] = useState(0)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [moveTarget, setMoveTarget] = useState<{ packedDate: string; row: PackingProductivityRow } | null>(null)

  const { user } = useCurrentUser()
  const canMoveDate = canMovePackDate(user)

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
  const showEarn = data?.with_earnings ?? false
  const isDayOpen = (day: PackingProductivityDay, idx: number) =>
    toggled[day.packed_date] ?? idx === 0

  return (
    <ListPage
      title="Производительность упаковки"
      subtitle={data
        ? `За период: ${data.total.toLocaleString('ru-RU')} шт (годный ${data.total_good.toLocaleString('ru-RU')} · брак ${data.total_defect.toLocaleString('ru-RU')})`
        : undefined}
      actions={
        <button className="btn ghost" onClick={goBack}>
          <Icon name="arrowLeft" size={14} />Задачи упаковки
        </button>
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: searchInput ? 26 : undefined }}
              placeholder="SKU или название товара…"
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
        <>
        {showEarn && data && (data.total_earn_kop > 0 || data.total > 0) && (
          <EarningsSummary
            good={data.total_good_earn_kop}
            defect={data.total_defect_earn_kop}
            total={data.total_earn_kop}
          />
        )}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <Table tableStyle={{ tableLayout: 'fixed' }}>
            {showEarn ? (
              <thead>
                <tr>
                  <th rowSpan={2} style={{ width: 150 }}>SKU</th>
                  <th rowSpan={2}>Товар</th>
                  <th rowSpan={2}>Клиент</th>
                  <th colSpan={2} style={{ textAlign: 'center', color: 'var(--c-success)', borderLeft: BORDER }}>Упаковка товара</th>
                  <th colSpan={2} style={{ textAlign: 'center', color: 'var(--c-warning)', borderLeft: BORDER }}>Брак</th>
                  <th rowSpan={2} style={{ width: 84, borderLeft: BORDER }} />
                  <th rowSpan={2} style={{ textAlign: 'right', width: 120, borderLeft: BORDER }}>Итого ₽</th>
                  {canMoveDate && <th rowSpan={2} style={{ width: 40 }} />}
                </tr>
                <tr>
                  <th style={{ textAlign: 'right', width: 66, borderLeft: BORDER }}>шт</th>
                  <th style={{ textAlign: 'right', width: 104 }}>₽</th>
                  <th style={{ textAlign: 'right', width: 66, borderLeft: BORDER }}>шт</th>
                  <th style={{ textAlign: 'right', width: 104 }}>₽</th>
                </tr>
              </thead>
            ) : (
              <thead>
                <tr>
                  <th style={{ width: 150 }}>SKU</th>
                  <th>Товар</th>
                  <th>Клиент</th>
                  <th style={{ textAlign: 'right', width: 90, borderLeft: BORDER }}>Годный</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Брак</th>
                  <th style={{ textAlign: 'right', width: 90 }}>Всего</th>
                  {canMoveDate && <th style={{ width: 40 }} />}
                </tr>
              </thead>
            )}
            {days.map((day, idx) => {
              const open = isDayOpen(day, idx)
              return (
                <tbody key={day.packed_date}>
                  <tr
                    onClick={() => setToggled((p) => ({ ...p, [day.packed_date]: !open }))}
                    style={{ cursor: 'pointer', fontWeight: 600, background: 'var(--c-bg-sunken)', borderTop: idx > 0 ? '2px solid var(--c-border)' : undefined }}
                  >
                    <Td colSpan={3}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Icon name="chev" size={13} style={{ color: 'var(--c-text-subtle)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                        <span className="mono" style={{ fontWeight: 600, fontSize: 13.5 }}>{fmtYmdAsDmy(day.packed_date)}</span>
                        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-subtle)' }}>{weekdayShort(day.packed_date)}</span>
                        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-subtle)' }}>{day.doc_count} отгр. · {day.sku_count} SKU</span>
                      </span>
                    </Td>
                    {showEarn ? <EarnCells m={day} /> : <QtyCells m={day} />}
                    {canMoveDate && <Td />}
                  </tr>
                  {open && day.rows.map((row) => {
                    const docId = row.doc_ids?.[0]
                    return (
                      <tr
                        key={`${day.packed_date}|${row.client_id ?? ''}|${row.product_id}`}
                        onClick={docId ? () => navigate(`/inventory/shipments/${docId}`) : undefined}
                        style={docId ? { cursor: 'pointer' } : undefined}
                        title={docId ? 'Открыть задачу упаковки' : undefined}
                      >
                        <Td className="mono" style={ELLIP}>{row.product_sku ?? '—'}</Td>
                        <Td style={ELLIP}>{row.product_name ?? '—'}</Td>
                        <Td className="t-sub" style={ELLIP}>{row.client_name ?? '—'}</Td>
                        {showEarn ? <EarnCells m={row} /> : <QtyCells m={row} />}
                        {canMoveDate && (
                          <Td style={{ textAlign: 'center' }}>
                            <button
                              className="btn ghost icon sm"
                              title="Перенести дату упаковки"
                              onClick={(e) => { e.stopPropagation(); setMoveTarget({ packedDate: day.packed_date, row }) }}
                            >
                              <Icon name="calendar" size={14} />
                            </button>
                          </Td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              )
            })}
          </Table>
        </div>
        </>
      )}
      {canMoveDate && moveTarget && (
        <MovePackDateDrawer
          packedDate={moveTarget.packedDate}
          row={moveTarget.row}
          onClose={() => setMoveTarget(null)}
          onMoved={() => setReloadTick((t) => t + 1)}
        />
      )}
    </ListPage>
  )
}

/** Сводка заработка за период: крупный итог + раздельные метрики «товар»/«брак»
 *  с долями и стек-баром их соотношения. */
function EarningsSummary({ good, defect, total }: { good: number; defect: number; total: number }) {
  const goodPct = total > 0 ? Math.round((good / total) * 100) : 0
  const defectPct = total > 0 ? 100 - goodPct : 0
  return (
    <div className="card" style={{ padding: '14px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 32, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>Заработок за период</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
            {formatMoneyKopecks(total)}
          </div>
        </div>
        <Metric color="success" label="Упаковка товара" value={good} pct={goodPct} />
        <Metric color="warning" label="Поиск брака" value={defect} pct={defectPct} />
      </div>
      <SplitBar good={good} defect={defect} total={total} />
    </div>
  )
}

function Metric({ color, label, value, pct }: { color: 'success' | 'warning'; label: string; value: number; pct: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-subtle)' }}>
        <span style={{ width: 9, height: 9, borderRadius: 3, background: `var(--c-${color})` }} />
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {formatMoneyKopecks(value)}
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-subtle)', marginLeft: 6 }}>{pct}%</span>
      </span>
    </div>
  )
}

/** Стек-бар соотношения заработка: зелёный сегмент — товар, янтарный — брак.
 *  Ненулевой сегмент получает минимальную ширину, иначе малая доля (брак 3–4%)
 *  на узком баре схлопывается до невидимой полоски. */
function SplitBar({ good, defect, total, width }: { good: number; defect: number; total: number; width?: number }) {
  if (total <= 0) {
    return width
      ? <span style={{ width, height: 8, borderRadius: 99, background: 'var(--c-bg-sunken)', display: 'inline-block' }} />
      : null
  }
  const goodPct = (good / total) * 100
  const both = good > 0 && defect > 0
  const minSeg = both ? 6 : 0
  return (
    <div style={{
      display: 'flex', gap: 2, height: width ? 8 : 10, marginTop: width ? 0 : 12,
      width: width ?? undefined, borderRadius: 99, overflow: 'hidden', background: 'var(--c-bg-sunken)',
      flexShrink: 0,
    }}>
      {good > 0 && (
        <div style={{ flexGrow: goodPct, flexBasis: 0, minWidth: minSeg, background: 'var(--c-success)' }} title={`Товар: ${formatMoneyKopecks(good)}`} />
      )}
      {defect > 0 && (
        <div style={{ flexGrow: 100 - goodPct, flexBasis: 0, minWidth: minSeg, background: 'var(--c-warning)' }} title={`Брак: ${formatMoneyKopecks(defect)}`} />
      )}
    </div>
  )
}
