import { useCallback, useEffect, useState } from 'react'
import { useNav } from '../../nav/NavContext'
import {
  getPackingProductivity,
  type PackingProductivityDay,
  type PackingProductivityResponse,
} from '../../api/shipmentsApi'
import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'
import { PullToRefresh } from '../../components/PullToRefresh'
import { MOSCOW_TZ, fmtDate, formatMoneyKopecks, moscowTodayYmd, parseMoscow } from '../../utils/format'

type Period = 'today' | 'week' | 'month'

const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: 'today', label: 'Сегодня', days: 0 },
  { key: 'week', label: 'Неделя', days: 6 },
  { key: 'month', label: 'Месяц', days: 29 },
]

// Дата-математика по календарным дням в UTC — без сдвига пояса устройства.
function ymdMinusDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10)
}

function weekdayShort(ymd: string): string {
  const d = parseMoscow(ymd)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { weekday: 'short', timeZone: MOSCOW_TZ })
}

export function PackingProductivityScreen() {
  const { back } = useNav()
  const [period, setPeriod] = useState<Period>('week')
  const [data, setData] = useState<PackingProductivityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((p: Period, signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    const to = moscowTodayYmd()
    const from = ymdMinusDays(to, PERIODS.find((x) => x.key === p)?.days ?? 6)
    return getPackingProductivity({ date_from: from, date_to: to }, signal)
      .then((r) => { if (!signal?.aborted) setData(r) })
      .catch((err) => { if (!signal?.aborted) setError(err instanceof Error ? err.message : 'Не удалось загрузить производительность') })
      .finally(() => { if (!signal?.aborted) setLoading(false) })
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    load(period, ac.signal)
    return () => ac.abort()
  }, [load, period])

  const days = data?.days ?? []
  const showEarn = data?.with_earnings ?? false

  return (
    <div className="screen">
      <AppBar title="Производительность" sub="Упаковка" onBack={back} noProfile />
      <PullToRefresh className="scroll pad-nav" onRefresh={() => load(period, undefined, true)}>
        <div className="tabs" style={{ marginBottom: 12 }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`tab${period === p.key ? ' active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="alert"><Icon name="alert" size={15} />{error}</div>
        )}

        {loading ? (
          <div className="center"><div className="spin" /><div>Загрузка…</div></div>
        ) : !data || data.total === 0 ? (
          !error && (
            <div className="center">
              <div className="center-ico green"><Icon name="check" size={26} /></div>
              <div>За период упаковки не было</div>
            </div>
          )
        ) : (
          <>
            <div className="sec">За период</div>
            <div className="summary" style={{ marginBottom: 16 }}>
              <div className="kv">
                <span className="k">Годный</span>
                <span className="v mono" style={{ color: 'var(--c-success)' }}>{data.total_good} шт</span>
              </div>
              <div className="kv">
                <span className="k">Брак</span>
                <span className="v mono" style={{ color: data.total_defect > 0 ? 'var(--c-danger)' : undefined }}>{data.total_defect} шт</span>
              </div>
              <div className="kv">
                <span className="k">Всего</span>
                <span className="v mono">{data.total} шт</span>
              </div>
              {showEarn && (
                <div className="kv">
                  <span className="k">Заработок</span>
                  <span className="v mono">{formatMoneyKopecks(data.total_earn_kop)}</span>
                </div>
              )}
            </div>

            <div className="sec">По дням<span className="sec-count">{days.length}</span></div>
            {days.map((day, i) => (
              <DayBlock key={day.packed_date} day={day} showEarn={showEarn} defaultOpen={i === 0} />
            ))}
          </>
        )}
      </PullToRefresh>
    </div>
  )
}

function DayBlock({ day, showEarn, defaultOpen }: { day: PackingProductivityDay; showEarn: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <button
        type="button"
        className={`sec sec-toggle${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sec-l">
          <Icon name="chev" size={13} className="sec-chev" />
          {fmtDate(day.packed_date)} · {weekdayShort(day.packed_date)}
        </span>
        <span className="sec-count">{day.total} шт · {day.doc_count} задач</span>
      </button>
      {open && (
        <div className="line" style={{ padding: '2px 14px' }}>
          {day.rows.map((r) => (
            <div key={`${r.product_id}:${r.client_id ?? ''}`} className="docline">
              <div className="docline-main">
                <div className="tile-title" style={{ fontSize: 14 }}>{r.product_name ?? '—'}</div>
                <div className="tile-meta">{[r.product_sku, r.client_name].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="docline-qty">
                <div className="big">{r.total} шт</div>
                <div className="small">
                  <span style={{ color: 'var(--c-success)' }}>годн {r.good}</span>
                  {r.defect > 0 && <span style={{ color: 'var(--c-danger)' }}> · брак {r.defect}</span>}
                  {showEarn && <> · {formatMoneyKopecks(r.earn_kop)}</>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
