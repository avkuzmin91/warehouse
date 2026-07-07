import { useMemo, useState } from 'react'
import { getPackingProductivity } from '../../../api/shipmentsApi'
import type { PackingProductivityResponse } from '../../../api/shipmentsApi'
import { ListPage } from '../../layouts/ListPage'
import { FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { formatMoneyKopecks, moscowTodayYmd, MOSCOW_TZ, parseMoscow } from '../../../utils/format'
import { useLookups } from '../../../hooks/useLookups'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { AnalyticsTabs } from './AnalyticsTabs'
import { PackingDayDrawer } from './PackingDayDrawer'
import {
  derive, ddmm, daysInclusive, isYmd, niceMax, fmtShort, shiftYmd, TOP_SKU_LIMIT,
} from './packingAnalytics'
import type { Derived, GapRow, Mode } from './packingAnalytics'

// Годный/брак закреплены по смыслу теми же тонами, что в производительности упаковки.
const GOOD = 'var(--c-success)'
const DEFECT = 'var(--c-warning)'

const PRESETS = [
  { d: 7, l: 'Неделя' },
  { d: 30, l: 'Месяц' },
  { d: 90, l: 'Квартал' },
] as const
const DEFAULT_PERIOD = 30

function weekdayShort(ymd: string): string {
  const d = parseMoscow(ymd)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: MOSCOW_TZ })
}

export function PackingAnalyticsFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'

  const [periodRaw] = useFilterParam('days', String(DEFAULT_PERIOD))
  const period = PRESETS.some((p) => p.d === Number(periodRaw)) ? Number(periodRaw) : DEFAULT_PERIOD
  const [fromRaw, setFromRaw] = useFilterParam('from', '')
  const [toRaw, setToRaw] = useFilterParam('to', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const { setMany } = useFilterParamsActions()
  const [mode, setMode] = useState<Mode>('qty')
  const [dayDetail, setDayDetail] = useState<string | null>(null)

  const { clients } = useLookups()

  const customFrom = isYmd(fromRaw) ? fromRaw : ''
  const customTo = isYmd(toRaw) ? toRaw : ''
  const hasCustom = Boolean(customFrom || customTo)

  const today = moscowTodayYmd()
  let effTo = hasCustom ? (customTo || customFrom) : today
  let effFrom = hasCustom ? (customFrom || customTo) : shiftYmd(today, -(period - 1))
  if (effFrom > effTo) [effFrom, effTo] = [effTo, effFrom]
  const shownDays = daysInclusive(effFrom, effTo)

  const { data, loading } = useApi(
    (signal) => getPackingProductivity(
      { date_from: effFrom, date_to: effTo, client_id: clientId || undefined }, signal,
    ),
    [effFrom, effTo, clientId],
  )

  const showMoney = data?.with_earnings ?? false
  const effMode: Mode = showMoney ? mode : 'qty'
  const derived = useMemo(() => (data ? derive(data, effFrom, effTo) : null), [data, effFrom, effTo])

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
        from={customFrom} to={customTo}
        onFromChange={setFromRaw} onToChange={setToRaw}
        onClear={() => setMany({ from: null, to: null })}
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

  if (!isFinance) {
    return (
      <ListPage title="Упаковка">
        <AnalyticsTabs active="packing" />
        <EmptyState title="Недостаточно прав" sub="Финансовая аналитика доступна администратору и менеджеру." />
      </ListPage>
    )
  }

  const hasData = data && data.total > 0

  return (
    <ListPage
      title="Упаковка"
      subtitle={`${ddmm(effFrom)} — ${ddmm(effTo)} · ${shownDays} дн.${data ? ` · упаковано ${data.total.toLocaleString('ru-RU')} шт` : ''}`}
      actions={actions}
    >
      <AnalyticsTabs active="packing" />
      {loading && !data ? (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      ) : !hasData || !derived || !data ? (
        <EmptyState
          title="За период записей упаковки нет"
          sub="Данные появляются после внесения упаковки в карточках отгрузок"
        />
      ) : (
        <Body data={data} d={derived} mode={effMode} onMode={showMoney ? setMode : undefined} onDay={setDayDetail} />
      )}
      <PackingDayDrawer day={dayDetail} clientId={clientId || undefined} onClose={() => setDayDetail(null)} />
    </ListPage>
  )
}

function Body({ data, d, mode, onMode, onDay }: {
  data: PackingProductivityResponse
  d: Derived
  mode: Mode
  onMode?: (m: Mode) => void
  onDay: (day: string) => void
}) {
  const total = data.total || 1
  const goodPct = Math.round((data.total_good / total) * 100)
  const defectPct = data.total > 0 ? 100 - goodPct : 0

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.with_earnings ? 4 : 3}, 1fr)`, gap: 12, marginBottom: 16 }}>
        <Kpi icon="box" label="Упаковано" value={data.total.toLocaleString('ru-RU')} unit="шт" sub="за период" />
        <Kpi icon="layers" label="Годный" value={data.total_good.toLocaleString('ru-RU')} unit="шт" sub={`${goodPct}% объёма`} tone={GOOD} />
        <Kpi icon="alert" label="Брак" value={data.total_defect.toLocaleString('ru-RU')} unit="шт" sub={`${defectPct}% объёма`} tone={DEFECT} />
        {data.with_earnings && (
          <Kpi icon="coins" label="Заработок" value={formatMoneyKopecks(data.total_earn_kop).replace(' ₽', '')} unit="₽" sub="упаковка + брак" />
        )}
      </div>

      <div className="an-card" style={{ marginBottom: 16 }}>
        <div className="an-card-head">
          <div className="an-card-ico"><Icon name="chart" size={14} /></div>
          <span className="an-card-title">{mode === 'money' ? 'Заработок по дням' : 'Объём упаковки по дням'}</span>
          <span className="an-card-hint" style={{ marginLeft: 'auto', marginRight: onMode ? 10 : undefined }}>
            годный · брак
          </span>
          {onMode && (
            <div className="preset">
              <button className={mode === 'qty' ? 'on' : ''} onClick={() => onMode('qty')}>Штуки</button>
              <button className={mode === 'money' ? 'on' : ''} onClick={() => onMode('money')}>Заработок ₽</button>
            </div>
          )}
        </div>
        <div style={{ padding: '18px 18px 12px' }}>
          <VolumeChart d={d} mode={mode} onDay={onDay} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start', marginBottom: 16 }}>
        <BreakdownCard
          icon="users" title="По клиентам" money={mode === 'money'}
          rows={d.byClient.map((c) => ({ key: c.client_id ?? '∅', label: c.client_name, good: c.good, defect: c.defect, total: c.total, earn_kop: c.earn_kop }))}
        />
        <BreakdownCard
          icon="tag" title="Топ SKU по объёму" money={mode === 'money'}
          hint={d.skuTotalCount > TOP_SKU_LIMIT ? `${TOP_SKU_LIMIT} из ${d.skuTotalCount}` : undefined}
          rows={d.topSkus.map((s) => ({ key: s.product_id, label: s.product_name ?? s.product_sku ?? '—', hint: s.product_sku ?? undefined, good: s.good, defect: s.defect, total: s.total, earn_kop: s.earn_kop }))}
        />
      </div>

      {data.with_earnings && <PriceGaps rows={d.gaps} />}
    </>
  )
}

function Kpi({ icon, label, value, unit, sub, tone }: {
  icon: IconName; label: string; value: string; unit?: string; sub?: string; tone?: string
}) {
  return (
    <div className="an-card" style={{ padding: '12px 14px' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--c-text-subtle)' }}>
        <Icon name={icon} size={13} />{label}
      </span>
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', marginTop: 4, color: tone }}>
        {value}{unit && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-subtle)', marginLeft: 4 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--c-text-faint)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function VolumeChart({ d, mode, onDay }: { d: Derived; mode: Mode; onDay: (day: string) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const money = mode === 'money'
  const goodArr = money ? d.goodEarnSeries : d.goodSeries
  const defectArr = money ? d.defectEarnSeries : d.defectSeries
  const totalArr = d.axis.map((_, i) => goodArr[i] + defectArr[i])
  const n = d.axis.length
  const axisMax = niceMax(Math.max(1, ...totalArr))
  const labelEvery = Math.max(1, Math.ceil(n / 14))

  const tip = hover == null ? null : {
    day: d.axis[hover],
    good: d.goodSeries[hover], defect: d.defectSeries[hover], total: d.totalSeries[hover],
    goodEarn: d.goodEarnSeries[hover], defectEarn: d.defectEarnSeries[hover], earn: d.earnSeries[hover],
    docs: d.docSeries[hover], skus: d.skuSeries[hover],
  }
  const f = hover == null ? 0 : (hover + 0.5) / n
  const tipTransform = f < 0.15 ? 'translateX(0)' : f > 0.85 ? 'translateX(-100%)' : 'translateX(-50%)'

  return (
    <>
      <div style={{ position: 'relative', height: 240 }} onMouseLeave={() => setHover(null)}>
        {[1, 0.75, 0.5, 0.25, 0].map((frac) => (
          <div key={frac} style={{ position: 'absolute', left: 56, right: 0, top: `${(1 - frac) * 100}%`, borderTop: '1px dashed var(--c-border)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', left: -56, width: 50, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-faint)', transform: 'translateY(-50%)' }}>
              {fmtShort(axisMax * frac, money)}
            </span>
          </div>
        ))}
        <div style={{ position: 'absolute', left: 56, right: 0, top: 0, bottom: 0, display: 'flex', gap: n > 40 ? 1 : 3 }}>
          {d.axis.map((day, i) => {
            const g = goodArr[i], df = defectArr[i]
            const dim = hover != null && hover !== i ? 0.4 : 1
            const hasData = d.totalSeries[i] > 0
            return (
              <div
                key={day}
                onMouseEnter={() => setHover(i)}
                onClick={hasData ? () => onDay(day) : undefined}
                style={{ flex: '1 1 0', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column-reverse', cursor: hasData ? 'pointer' : 'default', borderRadius: 3, background: hover === i ? 'var(--c-bg-hover)' : undefined }}
              >
                {g > 0 && <div style={{ height: `${(g / axisMax) * 100}%`, background: GOOD, opacity: dim }} />}
                {df > 0 && <div style={{ height: `${(df / axisMax) * 100}%`, background: DEFECT, opacity: dim, borderRadius: g > 0 ? 0 : '3px 3px 0 0' }} />}
              </div>
            )
          })}
        </div>
        {tip && (
          <div style={{ position: 'absolute', zIndex: 20, pointerEvents: 'none', left: `calc(56px + ${f} * (100% - 56px))`, top: 0, transform: tipTransform, background: 'var(--c-bg-elev)', border: '1px solid var(--c-border-strong)', borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-3)', padding: '9px 11px', minWidth: 180 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5 }}>
              {ddmm(tip.day)} <span style={{ fontWeight: 400, color: 'var(--c-text-subtle)' }}>{weekdayShort(tip.day)}</span>
            </div>
            <TipLine sw={GOOD} k={money ? 'Годный ₽' : 'Годный'} v={money ? formatMoneyKopecks(tip.goodEarn) : tip.good.toLocaleString('ru-RU')} />
            <TipLine sw={DEFECT} k={money ? 'Брак ₽' : 'Брак'} v={money ? formatMoneyKopecks(tip.defectEarn) : tip.defect.toLocaleString('ru-RU')} />
            <div style={{ marginTop: 5, paddingTop: 5, borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, fontWeight: 700 }}>
              <span>Итого</span>
              <span className="mono">{money ? formatMoneyKopecks(tip.earn) : `${tip.total.toLocaleString('ru-RU')} шт`}</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--c-text-faint)' }}>{tip.docs} задач · {tip.skus} SKU · клик — детализация</div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: n > 40 ? 1 : 3, marginLeft: 56, marginTop: 6 }}>
        {d.axis.map((day, i) => (
          <div key={day} style={{ flex: '1 1 0', minWidth: 0, textAlign: 'center', fontSize: 10, color: 'var(--c-text-faint)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {i % labelEvery === 0 || i === n - 1 ? ddmm(day) : ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingLeft: 56 }}>
        <span className="pnl-legend-it"><span className="pnl-bd-sw" style={{ background: GOOD }} />Годный</span>
        <span className="pnl-legend-it"><span className="pnl-bd-sw" style={{ background: DEFECT }} />Брак</span>
      </div>
    </>
  )
}

function TipLine({ sw, k, v }: { sw: string; k: string; v: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 11.5, padding: '1.5px 0' }}>
      <span style={{ color: 'var(--c-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: sw, flex: '0 0 8px' }} />{k}
      </span>
      <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  )
}

type BreakdownRow = { key: string; label: string; hint?: string; good: number; defect: number; total: number; earn_kop: number }

function BreakdownCard({ icon, title, hint, rows, money }: {
  icon: IconName; title: string; hint?: string; rows: BreakdownRow[]; money: boolean
}) {
  const metric = (r: BreakdownRow) => (money ? r.earn_kop : r.total)
  const totalSum = rows.reduce((s, r) => s + metric(r), 0)
  const max = Math.max(1, ...rows.map(metric))
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-ico"><Icon name={icon} size={14} /></div>
        <span className="an-card-title">{title}</span>
        <span className="an-card-hint">{hint ?? (money ? formatMoneyKopecks(totalSum) : `${totalSum.toLocaleString('ru-RU')} шт`)}</span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет данных за период</div>
        ) : rows.map((r) => {
          const val = metric(r)
          const pct = Math.round((val / max) * 100)
          const share = totalSum > 0 ? Math.round((val / totalSum) * 100) : 0
          const defectPct = r.total > 0 ? Math.round((r.defect / r.total) * 100) : 0
          return (
            <div key={r.key}>
              <div className="bd-top">
                <span className="bd-name">
                  <span className="nm" title={r.label}>{r.label}</span>
                  {r.hint && <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>{r.hint}</span>}
                  <span style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>· {share}%</span>
                </span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600, flexShrink: 0 }}>
                  {money ? formatMoneyKopecks(val) : val.toLocaleString('ru-RU')}
                </span>
              </div>
              <div style={{ display: 'flex', height: 7, borderRadius: 99, overflow: 'hidden', background: 'var(--c-bg-sunken)' }} title={`Годный ${r.good.toLocaleString('ru-RU')} · брак ${r.defect.toLocaleString('ru-RU')} (${defectPct}%)`}>
                {r.good > 0 && <div style={{ width: `${(r.good / Math.max(r.total, 1)) * pct}%`, background: GOOD }} />}
                {r.defect > 0 && <div style={{ width: `${(r.defect / Math.max(r.total, 1)) * pct}%`, background: DEFECT }} />}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PriceGaps({ rows }: { rows: GapRow[] }) {
  const totalUnpriced = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-ico" style={{ color: rows.length ? 'var(--c-warning)' : 'var(--c-success)' }}>
          <Icon name={rows.length ? 'alert' : 'coins'} size={14} />
        </div>
        <span className="an-card-title">Покрытие тарифами упаковки</span>
        <span className="an-card-hint">
          {rows.length ? `${rows.length} поз. без тарифа · ${totalUnpriced.toLocaleString('ru-RU')} шт не оценено` : 'все позиции оценены'}
        </span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: '18px 14px', fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
          У всех упакованных за период позиций задан тариф — заработок посчитан полностью.
        </div>
      ) : (
        <div style={{ padding: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 10 }}>
            По этим позициям упаковка внесена, но тариф на дату не заведён — заработок по ним не начислен (недосчитанная выручка). Задайте тариф в производительности упаковки.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--c-text-subtle)', fontSize: 11 }}>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>SKU</th>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>Товар</th>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>Клиент</th>
                <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Годный</th>
                <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Брак</th>
                <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Всего</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.product_id}|${r.client_name}`} style={{ borderTop: '1px solid var(--c-border)' }}>
                  <td className="mono" style={{ padding: '5px 8px' }}>{r.product_sku ?? '—'}</td>
                  <td style={{ padding: '5px 8px' }}>{r.product_name ?? '—'}</td>
                  <td className="t-sub" style={{ padding: '5px 8px' }}>{r.client_name}</td>
                  <td className="num" style={{ padding: '5px 8px', color: r.good > 0 ? 'var(--c-success)' : 'var(--c-text-faint)' }}>{r.good.toLocaleString('ru-RU')}</td>
                  <td className="num" style={{ padding: '5px 8px', color: r.defect > 0 ? 'var(--c-warning)' : 'var(--c-text-faint)' }}>{r.defect.toLocaleString('ru-RU')}</td>
                  <td className="num" style={{ padding: '5px 8px', fontWeight: 600 }}>{r.total.toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
