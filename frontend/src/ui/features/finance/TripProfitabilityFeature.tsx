import { getTripProfitability } from '../../../api/pnlApi'
import type { TripProfitItem } from '../../../api/pnlApi'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { Table, Td } from '../../data/Table'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useFilterParam } from '../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../utils/format'
import { AnalyticsTabs } from './AnalyticsTabs'

const PRESETS = [
  { d: 7, l: 'Неделя' },
  { d: 14, l: '2 недели' },
  { d: 30, l: 'Месяц' },
  { d: 90, l: '3 месяца' },
] as const
const DEFAULT_PERIOD = 30

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}
function ddmm(ymd: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : ymd
}
function fmtRub(kopecks: number): string {
  return Math.round(kopecks / 100).toLocaleString('ru-RU')
}
function fmtSignedRub(kopecks: number): string {
  const s = kopecks > 0 ? '+' : kopecks < 0 ? '−' : ''
  return s + Math.abs(Math.round(kopecks / 100)).toLocaleString('ru-RU')
}

export function TripProfitabilityFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'

  const [periodRaw, setPeriodRaw] = useFilterParam('days', String(DEFAULT_PERIOD))
  const period = PRESETS.some((p) => p.d === Number(periodRaw)) ? Number(periodRaw) : DEFAULT_PERIOD

  const today = moscowTodayYmd()
  const effTo = today
  const effFrom = shiftYmd(today, -(period - 1))

  const { data, loading, error } = useApi(
    (s) => getTripProfitability({ date_from: effFrom, date_to: effTo }, s),
    [effFrom, effTo],
  )

  if (!isFinance) {
    return (
      <ListPage title="Рентабельность рейсов">
        <AnalyticsTabs active="trips" />
        <EmptyState title="Недостаточно прав" sub="Финансовая аналитика доступна администратору и менеджеру." />
      </ListPage>
    )
  }

  const actions = (
    <div className="preset">
      {PRESETS.map((p) => (
        <button key={p.d} className={period === p.d ? 'on' : ''} onClick={() => setPeriodRaw(String(p.d))}>{p.l}</button>
      ))}
    </div>
  )

  return (
    <ListPage
      title="Рентабельность рейсов"
      subtitle={`По факту прибытия · ${ddmm(effFrom)} — ${ddmm(effTo)}`}
      actions={actions}
    >
      <AnalyticsTabs active="trips" />
      {loading && !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка…</div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : !data ? null : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <KpiCard icon="coins" label="Доход рейсов" value={fmtRub(data.income_total)} unit="₽" sub="логистика клиента + палеты" />
            <KpiCard icon="wallet" label="Себестоимость" value={fmtRub(data.cost_total)} unit="₽" sub="фактические расходы рейсов" />
            <KpiCard icon="chart" label="Маржа" value={fmtSignedRub(data.margin_total)} unit="₽"
              sub={data.margin_total >= 0 ? 'рейсы в плюсе' : 'рейсы в минусе'}
              tone={data.margin_total >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} />
          </div>

          {data.items.length === 0 ? (
            <EmptyState title="Нет рейсов за период" sub="За выбранный период нет прибывших рейсов." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Рейс</th>
                  <th>Прибытие</th>
                  <th>Перевозчик</th>
                  <th style={{ textAlign: 'right' }}>Доход</th>
                  <th style={{ textAlign: 'right' }}>Себестоимость</th>
                  <th style={{ textAlign: 'right' }}>Маржа</th>
                  <th style={{ textAlign: 'right' }}>Маржа, %</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((t) => <TripRow key={t.trip_id} t={t} />)}
              </tbody>
            </Table>
          )}
        </>
      )}
    </ListPage>
  )
}

function TripRow({ t }: { t: TripProfitItem }) {
  const tone = t.margin_kop >= 0 ? 'var(--c-success)' : 'var(--c-danger)'
  return (
    <tr>
      <Td>
        <span className="mono" style={{ fontWeight: 600 }}>{t.trip_number}</span>
        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--c-text-subtle)' }}>
          {t.direction === 'outbound' ? 'отгрузка' : 'поступление'} · {t.status_label}
        </span>
      </Td>
      <Td><span className="dt">{t.day ? ddmm(t.day) : '—'}</span></Td>
      <Td>{t.carrier_name || <span className="dash">—</span>}</Td>
      <Td style={{ textAlign: 'right' }}><span className="mono">{fmtRub(t.income_kop)}</span></Td>
      <Td style={{ textAlign: 'right' }}><span className="mono">{fmtRub(t.cost_kop)}</span></Td>
      <Td style={{ textAlign: 'right' }}><span className="mono" style={{ color: tone, fontWeight: 600 }}>{fmtSignedRub(t.margin_kop)}</span></Td>
      <Td style={{ textAlign: 'right' }}><span className="mono" style={{ color: tone }}>{String(t.margin_pct).replace('.', ',')}%</span></Td>
    </tr>
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
