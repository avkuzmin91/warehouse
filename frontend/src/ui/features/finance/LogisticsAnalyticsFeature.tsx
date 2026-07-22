import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLogisticsAnalytics } from '../../../api/pnlApi'
import type { LogisticsAnalytics, LogisticsGroupRow, TripProfitItem } from '../../../api/pnlApi'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { Table, Td } from '../../data/Table'
import { DateRange } from '../../data/DateRange'
import { FilterCombobox } from '../../data/FiltersBar'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useLookups } from '../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../utils/format'
import { AnalyticsTabs } from './AnalyticsTabs'

const PRESETS = [
  { d: 7, l: 'Неделя' },
  { d: 30, l: 'Месяц' },
  { d: 90, l: 'Квартал' },
] as const
const DEFAULT_PERIOD = 30

const COLOR_INBOUND = 'oklch(0.66 0.13 250)'
const COLOR_OUTBOUND = 'oklch(0.74 0.13 80)'

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}
function ddmm(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : ymd
}
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
const MONTHS_GEN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
function dayFull(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${d} ${MONTHS_GEN[m - 1]}, ${DOW_SHORT[dt.getUTCDay()]}`
}
function fmtRub(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString('ru-RU')
}
function fmtSignedRub(kopecks: number): string {
  const s = kopecks > 0 ? '+' : kopecks < 0 ? '−' : ''
  return s + Math.abs(Math.round(kopecks / 100)).toLocaleString('ru-RU')
}
function fmtShort(kopecks: number): string {
  const v = Math.abs(kopecks) / 100
  const sign = kopecks < 0 ? '−' : ''
  if (v >= 1_000_000) return sign + (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace('.', ',') + ' млн'
  if (v >= 1000) return sign + Math.round(v / 1000) + ' тыс'
  return sign + String(Math.round(v))
}
function fmtPct(pct: number | null): string {
  return pct == null ? '—' : `${String(pct).replace('.', ',')}%`
}
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * p
}

type ChartMode = 'money' | 'trips'

export function LogisticsAnalyticsFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'

  const [periodRaw] = useFilterParam('days', String(DEFAULT_PERIOD))
  const period = PRESETS.some((p) => p.d === Number(periodRaw)) ? Number(periodRaw) : DEFAULT_PERIOD
  const [fromRaw, setFromRaw] = useFilterParam('from', '')
  const [toRaw, setToRaw] = useFilterParam('to', '')
  const [direction, setDirection] = useFilterParam('dir', '')
  const [vehicleTypeId, setVehicleTypeId] = useFilterParam('vt', '')
  const [carrierId, setCarrierId] = useFilterParam('carrier', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const { setMany } = useFilterParamsActions()
  const { clients, carriers, vehicleTypes } = useLookups()
  const [chartMode, setChartMode] = useState<ChartMode>('money')
  const [selDay, setSelDay] = useState<string | null>(null)

  const customFrom = isYmd(fromRaw) ? fromRaw : ''
  const customTo = isYmd(toRaw) ? toRaw : ''
  const hasCustom = Boolean(customFrom || customTo)

  const today = moscowTodayYmd()
  let effTo = hasCustom ? (customTo || customFrom) : today
  let effFrom = hasCustom ? (customFrom || customTo) : shiftYmd(today, -(period - 1))
  if (effFrom > effTo) [effFrom, effTo] = [effTo, effFrom]

  const { data, loading, error } = useApi(
    (s) => getLogisticsAnalytics({
      date_from: effFrom,
      date_to: effTo,
      client_id: clientId || undefined,
      direction: direction || undefined,
      vehicle_type_id: vehicleTypeId || undefined,
      carrier_id: carrierId || undefined,
    }, s),
    [effFrom, effTo, clientId, direction, vehicleTypeId, carrierId],
  )

  useEffect(() => { setSelDay(null) }, [data])

  if (!isFinance) {
    return (
      <ListPage title="Логистика">
        <AnalyticsTabs active="logistics" />
        <EmptyState title="Недостаточно прав" sub="Финансовая аналитика доступна администратору и менеджеру." />
      </ListPage>
    )
  }

  const actions = (
    <div className="row gap-8" style={{ flexWrap: 'wrap', gap: 8 }}>
      <div className="preset">
        {PRESETS.map((p) => (
          <button
            key={p.d}
            className={!hasCustom && period === p.d ? 'on' : ''}
            onClick={() => setMany({ days: p.d === DEFAULT_PERIOD ? null : String(p.d), from: null, to: null })}
          >{p.l}</button>
        ))}
      </div>
      <DateRange
        from={customFrom}
        to={customTo}
        onFromChange={setFromRaw}
        onToChange={setToRaw}
        onClear={() => setMany({ from: null, to: null })}
      />
      <div className="preset">
        <button className={direction === '' ? 'on' : ''} onClick={() => setDirection('')}>Все рейсы</button>
        <button className={direction === 'inbound' ? 'on' : ''} onClick={() => setDirection('inbound')}>Поступления</button>
        <button className={direction === 'outbound' ? 'on' : ''} onClick={() => setDirection('outbound')}>Отгрузки</button>
      </div>
      <FilterCombobox
        label="Кузов"
        value={vehicleTypeId}
        options={[{ value: '', label: 'Все кузова' }, ...vehicleTypes.map((v) => ({ value: v.id, label: v.name }))]}
        onChange={(v) => setVehicleTypeId(v)}
        placeholder="Поиск кузова…"
      />
      <FilterCombobox
        label="Перевозчик"
        value={carrierId}
        options={[{ value: '', label: 'Все перевозчики' }, ...carriers.map((c) => ({ value: c.id, label: c.name }))]}
        onChange={(v) => setCarrierId(v)}
        placeholder="Поиск перевозчика…"
      />
      <FilterCombobox
        label="Клиент"
        value={clientId}
        options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
        onChange={(v) => setClientId(v)}
        placeholder="Поиск клиента…"
      />
    </div>
  )

  return (
    <ListPage
      title="Логистика"
      subtitle={`По факту прибытия рейса · ${ddmm(effFrom)} — ${ddmm(effTo)}`}
      actions={actions}
    >
      <AnalyticsTabs active="logistics" />
      {loading && !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : !data ? null : data.trips_total === 0 ? (
        <EmptyState title="Нет рейсов за период" sub="За выбранный период нет прибывших рейсов по заданным фильтрам." />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 10 }}>
            <KpiCard icon="truckRoute" label="Рейсы" value={String(data.trips_total)}
              sub={`поступления ${data.trips_inbound} · отгрузки ${data.trips_outbound}`} />
            <KpiCard icon="wallet" label="Потрачено" value={fmtRub(data.spent_total)} unit="₽"
              sub={`себестоимость + простой · в среднем ${fmtShort(data.avg_spent_kop)} ₽/рейс`} />
            <KpiCard icon="coins" label="Заработано" value={fmtRub(data.income_total)} unit="₽"
              sub={`логистика клиента · в среднем ${fmtShort(data.avg_income_kop)} ₽/рейс`} />
            <KpiCard icon="chart" label="Маржа" value={fmtSignedRub(data.margin_total)} unit="₽"
              sub={data.margin_pct == null ? 'к затратам' : `${fmtPct(data.margin_pct)} к затратам`}
              tone={data.margin_total >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginBottom: 16, fontSize: 12, color: 'var(--c-text-subtle)' }}>
            {data.waiting_total_kop > 0 && (
              <span>Простой: <b style={{ color: 'var(--c-text)' }}>{fmtRub(data.waiting_total_kop)} ₽</b> · {data.waiting_minutes_total.toLocaleString('ru-RU')} мин</span>
            )}
            {(data.trips_full > 0 || data.trips_partial > 0) && (
              <span>Загрузка: полная <b style={{ color: 'var(--c-text)' }}>{data.trips_full}</b> · частичная <b style={{ color: 'var(--c-text)' }}>{data.trips_partial}</b></span>
            )}
            {data.trips_no_income > 0 && (
              <span style={{ color: 'var(--c-warning)' }}>
                Без дохода: {data.trips_no_income} {tripsWord(data.trips_no_income)} — логистика клиенту не выставлена
              </span>
            )}
          </div>

          <div className="an-card" style={{ marginBottom: 16 }}>
            <div className="an-card-head">
              <div className="an-card-ico"><Icon name="chart" size={14} /></div>
              <span className="an-card-title">{chartMode === 'money' ? 'Деньги по дням' : 'Рейсы по дням'}</span>
              <span className="an-card-hint" style={{ marginLeft: 'auto', marginRight: 10 }}>
                {chartMode === 'money' ? 'заработано вверх · потрачено вниз' : 'поступления и отгрузки'}
              </span>
              <div className="preset">
                <button className={chartMode === 'money' ? 'on' : ''} onClick={() => setChartMode('money')}>Деньги</button>
                <button className={chartMode === 'trips' ? 'on' : ''} onClick={() => setChartMode('trips')}>Рейсы</button>
              </div>
            </div>
            <div style={{ padding: '18px 18px 14px' }}>
              {chartMode === 'money'
                ? <MoneyChart data={data} onSelectDay={setSelDay} />
                : <TripsChart data={data} onSelectDay={setSelDay} />}
            </div>
          </div>

          {selDay && <DayTrips day={selDay} items={data.items.filter((t) => t.day === selDay)} onClose={() => setSelDay(null)} />}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
            <GroupCard icon="truckRoute" title="По типам кузова" rows={data.by_vehicle} />
            <GroupCard icon="users" title="По перевозчикам" rows={data.by_carrier} />
          </div>
        </>
      )}
    </ListPage>
  )
}

function tripsWord(n: number): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return 'рейс'
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'рейса'
  return 'рейсов'
}

function usePlotWidth() {
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotW, setPlotW] = useState(700)
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPlotW(el.clientWidth))
    ro.observe(el)
    setPlotW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return { plotRef, plotW }
}

function MoneyChart({ data, onSelectDay }: { data: LogisticsAnalytics; onSelectDay: (d: string) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const [tipX, setTipX] = useState(0)
  const { plotRef, plotW } = usePlotWidth()
  const n = data.series.length
  const labelEvery = Math.max(1, Math.ceil(n / 15))

  const peak = Math.max(1, ...data.series.map((p) => Math.max(p.income_kop, p.spent_kop)))
  const axisMax = niceMax(peak)

  const onMove = (e: React.MouseEvent) => {
    const r = plotRef.current?.getBoundingClientRect()
    if (r) setTipX(e.clientX - r.left)
  }

  const tip = hover == null ? null : data.series[hover]

  return (
    <>
      <div className="pnl-plot" ref={plotRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[1, 0.5].map((f) => (
          <div key={`u${f}`} className="pnl-gl" style={{ top: `${(1 - f) * 25}%` }}><span className="yl">{fmtShort(axisMax * f)}</span></div>
        ))}
        <div className="pnl-zero"><span className="yl">0</span></div>
        {[0.5, 1].map((f) => (
          <div key={`d${f}`} className="pnl-gl" style={{ top: `${50 + f * 25}%` }}><span className="yl">{fmtShort(axisMax * f)}</span></div>
        ))}

        <div className="pnl-bars">
          {data.series.map((p, i) => {
            const dim = hover != null && hover !== i ? 0.45 : 1
            return (
              <div key={p.date} className={`pnl-col${hover === i ? ' sel' : ''}`} onMouseEnter={() => setHover(i)} onClick={() => onSelectDay(p.date)}>
                <div className="pnl-half up">
                  {p.income_kop > 0 && <div className="pnl-seg" style={{ height: `${(p.income_kop / axisMax) * 100}%`, background: 'var(--c-success)', opacity: dim }} />}
                </div>
                <div className="pnl-half dn">
                  {p.spent_kop > 0 && <div className="pnl-seg" style={{ height: `${(p.spent_kop / axisMax) * 100}%`, background: 'var(--c-danger)', opacity: dim }} />}
                </div>
              </div>
            )
          })}
        </div>

        {tip && (
          <div className="pnl-tip" style={{ left: Math.max(104, Math.min(tipX, plotW - 8)), top: 4, transform: tipX > plotW - 140 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            <div className="pnl-tip-date">{dayFull(tip.date)}</div>
            <div className="pnl-tip-line"><span className="k"><span className="pnl-tip-sw" style={{ background: 'var(--c-success)' }} />Заработано</span><span className="v">{fmtRub(tip.income_kop)}</span></div>
            <div className="pnl-tip-line"><span className="k"><span className="pnl-tip-sw" style={{ background: 'var(--c-danger)' }} />Потрачено</span><span className="v">{fmtRub(tip.spent_kop)}</span></div>
            <div className="pnl-tip-net"><span>Маржа дня</span><span className="mono" style={{ color: tip.income_kop - tip.spent_kop >= 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>{fmtSignedRub(tip.income_kop - tip.spent_kop)} ₽</span></div>
            <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--c-text-faint)' }}>Нажмите — рейсы дня</div>
          </div>
        )}
      </div>
      <div className="pnl-xaxis">
        {data.series.map((p, i) => <div key={p.date} className="pnl-xtick">{i % labelEvery === 0 || i === n - 1 ? ddmm(p.date) : ''}</div>)}
      </div>
    </>
  )
}

function TripsChart({ data, onSelectDay }: { data: LogisticsAnalytics; onSelectDay: (d: string) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const [tipX, setTipX] = useState(0)
  const { plotRef, plotW } = usePlotWidth()
  const n = data.series.length
  const labelEvery = Math.max(1, Math.ceil(n / 15))

  const peak = Math.max(1, ...data.series.map((p) => p.trips_inbound + p.trips_outbound))
  const axisMax = Math.max(2, Math.ceil(peak))
  const gridVals = axisMax % 2 === 0 ? [axisMax, axisMax / 2] : [axisMax]

  const onMove = (e: React.MouseEvent) => {
    const r = plotRef.current?.getBoundingClientRect()
    if (r) setTipX(e.clientX - r.left)
  }

  const tip = hover == null ? null : data.series[hover]

  return (
    <>
      <div className="plot" ref={plotRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {gridVals.map((gv, i) => (
          <div key={i} className="gridline" style={{ top: `${(1 - gv / axisMax) * 100}%` }}>
            <span className="yl">{gv}</span>
          </div>
        ))}
        <div className="gridline" style={{ top: '100%' }}><span className="yl">0</span></div>

        <div className="bars">
          {data.series.map((p, i) => {
            const total = p.trips_inbound + p.trips_outbound
            const dim = hover != null && hover !== i ? 0.45 : 1
            return (
              <div key={p.date} className={`bcol${hover === i ? ' sel' : ''}`} onMouseEnter={() => setHover(i)} onClick={() => onSelectDay(p.date)}>
                <div className="bstack" style={{ height: `${(total / axisMax) * 100}%` }}>
                  {total > 0 && p.trips_outbound > 0 && (
                    <div className="bseg" style={{ height: `${(p.trips_outbound / total) * 100}%`, background: COLOR_OUTBOUND, opacity: dim }} />
                  )}
                  {total > 0 && p.trips_inbound > 0 && (
                    <div className="bseg" style={{ height: `${(p.trips_inbound / total) * 100}%`, background: COLOR_INBOUND, opacity: dim }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {tip && (
          <div className="an-tip" style={{ left: Math.max(96, Math.min(tipX, plotW - 8)), top: 4, transform: tipX > plotW - 130 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            <div className="an-tip-date">{dayFull(tip.date)}</div>
            <div className="an-tip-total">{tip.trips_inbound + tip.trips_outbound} {tripsWord(tip.trips_inbound + tip.trips_outbound)}</div>
            <div className="an-tip-row"><span className="an-tip-sw" style={{ background: COLOR_INBOUND }} /><span className="an-tip-nm">Поступления</span><span className="an-tip-vl">{tip.trips_inbound}</span></div>
            <div className="an-tip-row"><span className="an-tip-sw" style={{ background: COLOR_OUTBOUND }} /><span className="an-tip-nm">Отгрузки</span><span className="an-tip-vl">{tip.trips_outbound}</span></div>
            <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--c-text-faint)' }}>Нажмите — рейсы дня</div>
          </div>
        )}
      </div>
      <div className="xaxis">
        {data.series.map((p, i) => <div key={p.date} className="xtick">{i % labelEvery === 0 || i === n - 1 ? ddmm(p.date) : ''}</div>)}
      </div>
      <div className="pnl-legend" style={{ marginTop: 12 }}>
        <span className="pnl-legend-it"><span className="pnl-bd-sw" style={{ background: COLOR_INBOUND }} />Поступления</span>
        <span className="pnl-legend-it"><span className="pnl-bd-sw" style={{ background: COLOR_OUTBOUND }} />Отгрузки</span>
      </div>
    </>
  )
}

function DayTrips({ day, items, onClose }: { day: string; items: TripProfitItem[]; onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="an-card" style={{ marginBottom: 16 }}>
      <div className="an-card-head">
        <div className="an-card-ico"><Icon name="truckRoute" size={14} /></div>
        <span className="an-card-title">Рейсы за {dayFull(day)}</span>
        <span className="an-card-hint">{items.length} {tripsWord(items.length)}</span>
        <button className="btn ghost sm icon" style={{ marginLeft: 8 }} onClick={onClose} title="Скрыть">
          <Icon name="x" size={14} />
        </button>
      </div>
      {items.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>За этот день рейсов нет</div>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Рейс</th>
              <th>Кузов</th>
              <th>Перевозчик</th>
              <th style={{ textAlign: 'right' }}>Заработано</th>
              <th style={{ textAlign: 'right' }}>Потрачено</th>
              <th style={{ textAlign: 'right' }}>Маржа</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const margin = t.income_kop - t.spent_kop
              const tone = margin >= 0 ? 'var(--c-success)' : 'var(--c-danger)'
              return (
                <tr key={t.trip_id} onClick={() => navigate(`/logistics/trips/${t.trip_id}`)} style={{ cursor: 'pointer' }} title="Открыть рейс">
                  <Td>
                    <span className="mono" style={{ fontWeight: 600 }}>{t.trip_number}</span>
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--c-text-subtle)' }}>
                      {t.direction === 'outbound' ? 'отгрузка' : 'поступление'}
                    </span>
                  </Td>
                  <Td>{t.vehicle_type_name || <span className="dash">—</span>}</Td>
                  <Td>{t.carrier_name || <span className="dash">—</span>}</Td>
                  <Td style={{ textAlign: 'right' }}><span className="mono">{fmtRub(t.income_kop)}</span></Td>
                  <Td style={{ textAlign: 'right' }}><span className="mono">{fmtRub(t.spent_kop)}</span></Td>
                  <Td style={{ textAlign: 'right' }}><span className="mono" style={{ color: tone, fontWeight: 600 }}>{fmtSignedRub(margin)}</span></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}

function GroupCard({ icon, title, rows }: { icon: IconName; title: string; rows: LogisticsGroupRow[] }) {
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-ico"><Icon name={icon} size={14} /></div>
        <span className="an-card-title">{title}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет данных за период</div>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{title === 'По перевозчикам' ? 'Перевозчик' : 'Кузов'}</th>
              <th style={{ textAlign: 'right' }}>Рейсы</th>
              <th style={{ textAlign: 'right' }}>Потрачено</th>
              <th style={{ textAlign: 'right' }}>Заработано</th>
              <th style={{ textAlign: 'right' }}>Маржа</th>
              <th style={{ textAlign: 'right' }}>%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const tone = g.margin_kop >= 0 ? 'var(--c-success)' : 'var(--c-danger)'
              return (
                <tr key={g.id ?? '__none'}>
                  <Td>
                    <span style={{ fontWeight: 500, color: g.id ? undefined : 'var(--c-text-subtle)' }}>{g.name}</span>
                    {(g.waiting_kop > 0 || g.trips_no_income > 0) && (
                      <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 1 }}>
                        {g.waiting_kop > 0 && <>простой {fmtRub(g.waiting_kop)} ₽</>}
                        {g.waiting_kop > 0 && g.trips_no_income > 0 && ' · '}
                        {g.trips_no_income > 0 && <span style={{ color: 'var(--c-warning)' }}>без дохода {g.trips_no_income}</span>}
                      </div>
                    )}
                  </Td>
                  <Td style={{ textAlign: 'right' }}>
                    <span className="mono" style={{ fontWeight: 600 }}>{g.trips}</span>
                    <div style={{ fontSize: 10.5, color: 'var(--c-text-subtle)' }}>{g.trips_inbound} пост. · {g.trips_outbound} отгр.</div>
                  </Td>
                  <Td style={{ textAlign: 'right' }}><span className="mono">{fmtRub(g.spent_kop)}</span></Td>
                  <Td style={{ textAlign: 'right' }}><span className="mono">{fmtRub(g.income_kop)}</span></Td>
                  <Td style={{ textAlign: 'right' }}><span className="mono" style={{ color: tone, fontWeight: 600 }}>{fmtSignedRub(g.margin_kop)}</span></Td>
                  <Td style={{ textAlign: 'right' }}><span className="mono" style={{ color: tone }}>{fmtPct(g.margin_pct)}</span></Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </div>
  )
}

function KpiCard({ icon, label, value, unit, sub, tone }: {
  icon: IconName
  label: string
  value: string
  unit?: string
  sub?: string
  tone?: string
}) {
  return (
    <div className="an-card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: 'var(--c-text-subtle)', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
        <Icon name={icon} size={13} />{label}
      </span>
      <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.01em', color: tone || 'var(--c-text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}{unit && <span style={{ fontSize: 12, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 3 }}>{unit}</span>}
      </span>
      {sub && <span style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{sub}</span>}
    </div>
  )
}
