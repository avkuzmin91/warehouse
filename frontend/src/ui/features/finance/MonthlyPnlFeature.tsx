import { getPnlMonthly } from '../../../api/pnlApi'
import type { MonthlyPnl } from '../../../api/pnlApi'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../utils/format'
import { AnalyticsTabs } from './AnalyticsTabs'

// До 22.06.2026 финансовые данные вносились нерегулярно — как и в «Доходах и расходах»,
// совмещённый расчёт (доход vs расход) начинаем с этой даты.
const DATA_START = '2026-06-22'

const PRESETS = [
  { id: 'all', l: 'Всё время' },
  { id: '6', l: '6 мес' },
  { id: '12', l: '12 мес' },
] as const
type PresetId = (typeof PRESETS)[number]['id']
const DEFAULT_PRESET: PresetId = 'all'

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${y}`
}
function monthStartBack(todayYmd: string, monthsBack: number): string {
  const [y, m] = todayYmd.split('-').map(Number)
  const total = y * 12 + (m - 1) - monthsBack
  const yy = Math.floor(total / 12)
  const mm = total % 12
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`
}
function fmtRub(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString('ru-RU')
}
function fmtQty(v: number): string {
  return v.toLocaleString('ru-RU')
}
// Средний доход на упаковку — рубли с копейками (в финмодели значим и рубль, и его доли).
function fmtRubExact(kopecks: number): string {
  return (kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Row = {
  key: string
  label: string
  values: (string | null)[]   // по месяцам; null — «—»
  total: string | null
  indent?: boolean            // строка-составляющая внутри секции
  bold?: boolean              // итоговая строка секции
  tones?: (string | undefined)[]  // цвет значения по месяцам (для EBITDA)
  totalTone?: string
}

function moneyRow(
  key: string, label: string, series: number[], total: number,
  opts: { indent?: boolean; bold?: boolean; signed?: boolean } = {},
): Row {
  const tone = (v: number) => (opts.signed ? (v > 0 ? 'var(--c-success)' : v < 0 ? 'var(--c-danger)' : undefined) : undefined)
  return {
    key, label,
    values: series.map((v) => fmtRub(v)),
    total: fmtRub(total),
    indent: opts.indent, bold: opts.bold,
    tones: opts.signed ? series.map((v) => tone(v)) : undefined,
    totalTone: opts.signed ? tone(total) : undefined,
  }
}

function buildRows(data: MonthlyPnl): { section: string; rows: Row[] }[] {
  const sum = (s: number[]) => s.reduce((a, v) => a + v, 0)

  const ops: Row[] = [
    {
      key: 'packed', label: 'Упаковано, шт.',
      values: data.packed_total.map((v) => fmtQty(v)),
      total: fmtQty(sum(data.packed_total)), bold: true,
    },
  ]
  if (sum(data.packed_defect) > 0) {
    ops.push({
      key: 'packed_defect', label: 'в т.ч. брак, шт.',
      values: data.packed_defect.map((v) => fmtQty(v)),
      total: fmtQty(sum(data.packed_defect)), indent: true,
    })
  }
  const packedTotal = sum(data.packed_total)
  const packingIncomeTotal = data.income_sources
    .filter((s) => s.key === 'packing_good' || s.key === 'packing_defect')
    .reduce((a, s) => a + s.amount, 0)
  ops.push({
    key: 'avg_income', label: 'Средний доход на 1 упаковку, ₽',
    values: data.avg_packing_income_kop.map((v) => (v == null ? null : fmtRubExact(v))),
    total: packedTotal > 0 ? fmtRubExact(packingIncomeTotal / packedTotal) : null,
  })

  const income: Row[] = [
    moneyRow('income_total', 'Доходы, всего', data.income_series, data.income_total, { bold: true }),
    ...data.income_sources.map((s) =>
      moneyRow(`inc_${s.key}`, s.label, s.series, s.amount, { indent: true })),
  ]

  const expense: Row[] = [
    moneyRow('expense_total', 'Расходы OPEX, всего', data.expense_series, data.expense_total, { bold: true }),
    ...data.expense_categories.map((c) =>
      moneyRow(`exp_${c.key}`, c.label, c.series, c.amount, { indent: true })),
  ]

  const result: Row[] = [
    moneyRow('ebitda', 'EBITDA (доход − расход)', data.net_series, data.net_total, { bold: true, signed: true }),
    {
      key: 'margin', label: 'Маржа EBITDA, %',
      values: data.margin_series.map((v) => (v == null ? null : `${v.toLocaleString('ru-RU')}%`)),
      total: data.margin_pct == null ? null : `${data.margin_pct.toLocaleString('ru-RU')}%`,
      tones: data.margin_series.map((v) =>
        v == null ? undefined : v > 0 ? 'var(--c-success)' : v < 0 ? 'var(--c-danger)' : undefined),
      totalTone: data.margin_pct == null ? undefined
        : data.margin_pct > 0 ? 'var(--c-success)' : data.margin_pct < 0 ? 'var(--c-danger)' : undefined,
    },
  ]

  return [
    { section: 'Операционные показатели', rows: ops },
    { section: 'Доходы, ₽', rows: income },
    { section: 'Расходы OPEX, ₽', rows: expense },
    { section: 'Итог', rows: result },
  ]
}

export function MonthlyPnlFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'
  const isAdmin = user?.role === 'admin'

  const [presetRaw] = useFilterParam('period', DEFAULT_PRESET)
  const preset: PresetId = PRESETS.some((p) => p.id === presetRaw) ? (presetRaw as PresetId) : DEFAULT_PRESET
  const { setMany } = useFilterParamsActions()

  const today = moscowTodayYmd()
  let effFrom = DATA_START
  if (preset !== 'all') {
    const back = monthStartBack(today, Number(preset) - 1)
    if (back > effFrom) effFrom = back
  }

  const { data, loading, error } = useApi(
    (s) => getPnlMonthly({ date_from: effFrom, date_to: today }, s),
    [effFrom, today],
  )

  if (!isFinance) {
    return (
      <ListPage title="Финмодель по факту">
        <AnalyticsTabs active="monthly" />
        <EmptyState title="Недостаточно прав" sub="Финмодель доступна администратору и менеджеру." />
      </ListPage>
    )
  }

  function exportCsv() {
    if (!data) return
    const header = ['Показатель', ...data.months.map(monthLabel), 'Итого']
    const lines = [header.join(';')]
    buildRows(data).forEach(({ section, rows }) => {
      lines.push(section)
      rows.forEach((r) => {
        const cells = r.values.map((v) => (v == null ? '' : v.replace(/ /g, '')))
        lines.push([r.label, ...cells, r.total?.replace(/ /g, '') ?? ''].join(';'))
      })
    })
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `monthly-pnl-${data.date_from}_${data.date_to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const actions = (
    <div className="row gap-8" style={{ flexWrap: 'wrap', gap: 8 }}>
      <div className="preset">
        {PRESETS.map((p) => (
          <button key={p.id} className={preset === p.id ? 'on' : ''}
            onClick={() => setMany({ period: p.id === DEFAULT_PRESET ? null : p.id })}>{p.l}</button>
        ))}
      </div>
      {isAdmin && (
        <button className="btn" onClick={exportCsv} disabled={!data || data.months.length === 0}>
          <Icon name="download" size={14} />Выгрузить
        </button>
      )}
    </div>
  )

  return (
    <ListPage
      title="Финмодель по факту"
      subtitle="Помесячно: операционные показатели, доходы по услугам, расходы по статьям, EBITDA"
      actions={actions}
    >
      <AnalyticsTabs active="monthly" />
      {loading && !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка финмодели…</div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить финмодель" sub={error.message} />
      ) : !data || data.months.length === 0 ? (
        <EmptyState title="Нет данных за период" />
      ) : (
        <MonthlyTable data={data} />
      )}
    </ListPage>
  )
}

function MonthlyTable({ data }: { data: MonthlyPnl }) {
  const sections = buildRows(data)
  const nm = data.months.length

  const cellBase: React.CSSProperties = {
    padding: '7px 12px', fontSize: 12.5, whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--c-border)', textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  }
  const nameCell: React.CSSProperties = {
    ...cellBase, textAlign: 'left', position: 'sticky', left: 0,
    background: 'var(--c-bg-elev)', zIndex: 1, minWidth: 240,
  }

  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-ico"><Icon name="chart" size={14} /></div>
        <span className="an-card-title">Помесячная финмодель</span>
        <span className="an-card-hint">
          {monthLabel(data.months[0])} — {monthLabel(data.months[nm - 1])} · крайние месяцы могут быть неполными
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...nameCell, fontWeight: 600, color: 'var(--c-text-subtle)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Показатель</th>
              {data.months.map((m) => (
                <th key={m} style={{ ...cellBase, fontWeight: 600, color: 'var(--c-text-subtle)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{monthLabel(m)}</th>
              ))}
              <th style={{ ...cellBase, fontWeight: 700, color: 'var(--c-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Итого</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(({ section, rows }) => (
              <SectionRows key={section} section={section} rows={rows} months={nm} cellBase={cellBase} nameCell={nameCell} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SectionRows({ section, rows, months, cellBase, nameCell }: {
  section: string
  rows: Row[]
  months: number
  cellBase: React.CSSProperties
  nameCell: React.CSSProperties
}) {
  return (
    <>
      <tr>
        <td colSpan={months + 2} style={{
          padding: '10px 12px 5px', fontSize: 11, fontWeight: 700, color: 'var(--c-text-subtle)',
          textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--c-border)',
          background: 'var(--c-bg-sunken)', position: 'sticky', left: 0,
        }}>{section}</td>
      </tr>
      {rows.map((r) => (
        <tr key={r.key}>
          <td style={{
            ...nameCell,
            paddingLeft: r.indent ? 26 : 12,
            fontWeight: r.bold ? 600 : 400,
            color: r.indent ? 'var(--c-text-muted)' : 'var(--c-text)',
          }}>{r.label}</td>
          {r.values.map((v, i) => (
            <td key={i} className="mono" style={{
              ...cellBase,
              fontWeight: r.bold ? 600 : 400,
              color: r.tones?.[i] ?? (r.indent ? 'var(--c-text-muted)' : 'var(--c-text)'),
            }}>{v ?? '—'}</td>
          ))}
          <td className="mono" style={{
            ...cellBase,
            fontWeight: r.bold ? 700 : 500,
            color: r.totalTone ?? 'var(--c-text)',
            background: 'var(--c-bg-sunken)',
          }}>{r.total ?? '—'}</td>
        </tr>
      ))}
    </>
  )
}
