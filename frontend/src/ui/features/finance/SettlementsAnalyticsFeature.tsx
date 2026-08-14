import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getReceivablesAnalytics } from '../../../api/invoicesApi'
import type { ReceivablesAnalytics, SettlementAgingBucket } from '../../../api/invoicesApi'
import { getPayablesAnalytics } from '../../../api/expensesApi'
import type { PayablesAnalytics } from '../../../api/expensesApi'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import type { IconName } from '../../primitives/Icon'
import { EmptyState } from '../../primitives/EmptyState'
import { DateRange } from '../../data/DateRange'
import { FilterCombobox } from '../../data/FiltersBar'
import { useApi } from '../../../hooks/useApi'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useLookups } from '../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions } from '../../../hooks/useFilterParams'
import { moscowTodayYmd } from '../../../utils/format'
import { AnalyticsTabs } from './AnalyticsTabs'

const PRESETS = [30, 90, 180] as const
const DEFAULT_PERIOD = 30

type Side = 'ar' | 'ap'

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}
function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
function ddmm(ymd: string): string {
  return isYmd(ymd) ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : ymd
}

const MONTHS_GEN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function fmtDayFull(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  void y
  return `${d} ${MONTHS_GEN[m - 1]}`
}

// Деньги хранятся в копейках: рубли с неразрывным разделителем разрядов.
function fmtRub(kopecks: number): string {
  const sign = kopecks < 0 ? '−' : ''
  return sign + Math.round(Math.abs(kopecks) / 100).toLocaleString('ru-RU').replace(/ /g, ' ')
}
function fmtShort(kopecks: number): string {
  const v = Math.abs(kopecks) / 100
  const sign = kopecks < 0 ? '−' : ''
  if (v >= 1_000_000) return sign + (v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace('.', ',') + ' млн'
  if (v >= 1000) return sign + Math.round(v / 1000) + ' тыс'
  return sign + String(Math.round(v))
}
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * p
}
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}

export function SettlementsAnalyticsFeature() {
  const { user } = useCurrentUser()
  const isFinance = user?.role === 'admin' || user?.role === 'manager'
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const { clients, carriers } = useLookups()

  const [periodRaw] = useFilterParam('days', String(DEFAULT_PERIOD))
  const period = PRESETS.includes(Number(periodRaw) as 30 | 90 | 180) ? Number(periodRaw) : DEFAULT_PERIOD
  const [fromRaw, setFromRaw] = useFilterParam('from', '')
  const [toRaw, setToRaw] = useFilterParam('to', '')
  const [sideRaw, setSide] = useFilterParam('side', 'ar')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [carrierId, setCarrierId] = useFilterParam('carrier', '')
  const { setMany } = useFilterParamsActions()
  const side: Side = sideRaw === 'ap' ? 'ap' : 'ar'

  const customFrom = isYmd(fromRaw) ? fromRaw : ''
  const customTo = isYmd(toRaw) ? toRaw : ''
  const hasCustom = Boolean(customFrom || customTo)

  const today = moscowTodayYmd()
  let effFrom = hasCustom ? (customFrom || customTo) : shiftYmd(today, -(period - 1))
  let effTo = hasCustom ? (customTo || customFrom) : today
  if (effFrom > effTo) [effFrom, effTo] = [effTo, effFrom]
  const periodDays = Math.round((ymdToUtc(effTo) - ymdToUtc(effFrom)) / 86_400_000) + 1

  const { data: ar, loading: arLoading, error: arError } = useApi(
    (s) => getReceivablesAnalytics({ date_from: effFrom, date_to: effTo, client_id: clientId || undefined }, s),
    [effFrom, effTo, clientId],
  )
  const { data: ap, loading: apLoading, error: apError } = useApi(
    (s) => getPayablesAnalytics({ date_from: effFrom, date_to: effTo, carrier_id: carrierId || undefined }, s),
    [effFrom, effTo, carrierId],
  )

  if (!isFinance) {
    return (
      <ListPage title="Расчёты">
        <AnalyticsTabs active="settlements" />
        <EmptyState title="Недостаточно прав" sub="Контроль расчётов доступен администратору и менеджеру." />
      </ListPage>
    )
  }

  function exportCsv() {
    if (!ar || !ap) return
    const rows = [['Дата', 'Выставлено', 'Оплачено', 'Долг клиентов', 'Начислено', 'Выплачено', 'Долг поставщикам'].join(';')]
    ar.series.forEach((p, i) => {
      const q = ap.series[i]
      rows.push([
        p.date,
        Math.round(p.issued_kop / 100), Math.round(p.paid_kop / 100), Math.round(p.outstanding_kop / 100),
        Math.round((q?.accrued_kop ?? 0) / 100), Math.round((q?.paid_kop ?? 0) / 100), Math.round((q?.outstanding_kop ?? 0) / 100),
      ].join(';'))
    })
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `settlements-${effFrom}_${effTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasFilter = Boolean(clientId || carrierId)
  const actions = (
    <>
      <div className="preset">
        {PRESETS.map((p) => (
          <button key={p} className={!hasCustom && period === p ? 'on' : ''}
            onClick={() => setMany({ days: p === DEFAULT_PERIOD ? null : String(p), from: null, to: null })}>{p} дн.</button>
        ))}
      </div>
      <DateRange
        from={customFrom}
        to={customTo}
        onFromChange={setFromRaw}
        onToChange={setToRaw}
        onClear={() => setMany({ from: null, to: null })}
      />
      {(hasCustom || period !== DEFAULT_PERIOD || hasFilter) && (
        <button className="btn ghost sm" onClick={() => setMany({ days: null, from: null, to: null, client: null, carrier: null })}>
          <Icon name="x" size={12} />Сбросить
        </button>
      )}
      {isAdmin && (
        <button className="btn" onClick={exportCsv} disabled={!ar || !ap}>
          <Icon name="download" size={14} />Выгрузить
        </button>
      )}
    </>
  )

  const loading = (arLoading && !ar) || (apLoading && !ap)
  const error = arError ?? apError

  return (
    <ListPage
      title="Расчёты"
      subtitle={`Период: ${ddmm(effFrom)} — ${ddmm(effTo)} · ${periodDays} дн.`}
      actions={actions}
    >
      <AnalyticsTabs active="settlements" />
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Загрузка расчётов…</div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить расчёты" sub={error.message} />
      ) : !ar || !ap ? null : (
        <>
          <BalanceHeader ar={ar} ap={ap} filtered={hasFilter} />

          <div className="tabs" style={{ marginTop: 16, marginBottom: 14 }}>
            <button className={`tab${side === 'ar' ? ' active' : ''}`} onClick={() => setSide('ar')}>
              Клиенты нам<span className="tab-count">{fmtShort(ar.debt_kop)}</span>
            </button>
            <button className={`tab${side === 'ap' ? ' active' : ''}`} onClick={() => setSide('ap')}>
              Мы поставщикам<span className="tab-count">{fmtShort(ap.debt_kop)}</span>
            </button>
          </div>

          {side === 'ar' ? (
            <ReceivablesPane
              data={ar}
              clientId={clientId}
              clientOptions={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
              onClient={setClientId}
              onOpenClient={(id, overdue) =>
                navigate(`/finance/invoices?client=${encodeURIComponent(id)}${overdue ? '&status=overdue' : ''}`)}
            />
          ) : (
            <PayablesPane
              data={ap}
              carrierId={carrierId}
              carrierOptions={[{ value: '', label: 'Все перевозчики' }, ...carriers.map((c) => ({ value: c.id, label: c.name }))]}
              onCarrier={setCarrierId}
              onOpenExpenses={() => navigate('/finance/expenses?payment_status=awaiting')}
            />
          )}
        </>
      )}
    </ListPage>
  )
}

/** Платёжный баланс периода: обе стороны в одной строке — поток денег и чистая позиция. */
function BalanceHeader({ ar, ap, filtered }: { ar: ReceivablesAnalytics; ap: PayablesAnalytics; filtered: boolean }) {
  const flow = ar.paid_kop - ap.paid_kop
  const position = ar.debt_kop - ap.debt_kop
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-ico"><Icon name="banknote" size={14} /></div>
        <span className="an-card-title">Платёжный баланс за период</span>
        <span className="an-card-hint">
          {filtered ? 'учтены активные фильтры' : 'касса по факту оплат, долг — на конец периода'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 12px repeat(3, 1fr)', alignItems: 'stretch' }}>
        <BalanceCell label="Пришло от клиентов" value={fmtRub(ar.paid_kop)} tone="var(--c-success)" />
        <BalanceCell label="Выплачено поставщикам" value={fmtRub(ap.paid_kop)} tone="var(--c-danger)" />
        <BalanceCell label="Чистый поток" value={fmtRub(flow)} big
          tone={flow >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} />
        <div style={{ borderLeft: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)' }} />
        <BalanceCell label="Нам должны" value={fmtRub(ar.debt_kop)} sub={`${ar.debt_count} ${plural(ar.debt_count, 'счёт', 'счёта', 'счетов')}`} />
        <BalanceCell label="Мы должны" value={fmtRub(ap.debt_kop)} sub={`${ap.debt_count} ${plural(ap.debt_count, 'расход', 'расхода', 'расходов')}`} />
        <BalanceCell label="Чистая позиция" value={fmtRub(position)} big
          tone={position >= 0 ? 'var(--c-success)' : 'var(--c-danger)'} />
      </div>
    </div>
  )
}

function BalanceCell({ label, value, sub, tone, big }: {
  label: string
  value: string
  sub?: string
  tone?: string
  big?: boolean
}) {
  return (
    <div style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 11.5, color: 'var(--c-text-subtle)', marginBottom: 5 }}>{label}</div>
      <div className="mono" style={{
        fontSize: big ? 22 : 18, fontWeight: big ? 700 : 600, letterSpacing: '-0.01em',
        color: tone ?? 'var(--c-text)', fontVariantNumeric: 'tabular-nums',
      }}>
        {value}<span style={{ fontSize: 12, color: 'var(--c-text-subtle)', fontWeight: 500, marginLeft: 3 }}>₽</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--c-text-faint)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function ReceivablesPane({ data, clientId, clientOptions, onClient, onOpenClient }: {
  data: ReceivablesAnalytics
  clientId: string
  clientOptions: { value: string; label: string }[]
  onClient: (v: string) => void
  onOpenClient: (clientId: string, overdue: boolean) => void
}) {
  const agingTotal = data.aging.reduce((s, b) => s + b.amount_kop, 0)
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard icon="receipt" label="Выставлено" value={fmtRub(data.issued_kop)} unit="₽"
          sub={data.cancelled_kop > 0
            ? `${data.issued_count} ${plural(data.issued_count, 'счёт', 'счёта', 'счетов')} · аннулировано ${fmtShort(data.cancelled_kop)}`
            : `${data.issued_count} ${plural(data.issued_count, 'счёт', 'счёта', 'счетов')} за период`} />
        <StatCard icon="wallet" label="Оплачено" value={fmtRub(data.paid_kop)} unit="₽"
          sub={`${data.payment_count} ${plural(data.payment_count, 'платёж', 'платежа', 'платежей')}`}
          tone="var(--c-success)" />
        <StatCard icon="pulse" label="Собираемость" value={String(data.collected_pct).replace('.', ',')} unit="%"
          sub="из выставленного в периоде"
          tone={data.collected_pct >= 80 ? 'var(--c-success)' : data.collected_pct >= 50 ? undefined : 'var(--c-warning)'} />
        <StatCard icon="coins" label="Долг на конец" value={fmtRub(data.debt_kop)} unit="₽"
          sub={`на начало ${fmtShort(data.opening_debt_kop)}`} />
        <StatCard icon="alert" label="Просрочено" value={fmtRub(data.overdue_kop)} unit="₽"
          sub={`${data.overdue_count} ${plural(data.overdue_count, 'счёт', 'счёта', 'счетов')}`}
          tone={data.overdue_kop > 0 ? 'var(--c-danger)' : undefined} />
        <StatCard icon="timer" label="Средний срок оплаты" value={String(data.avg_days_to_pay).replace('.', ',')} unit="дн."
          sub="взвешенный по сумме" />
      </div>

      <PairChart
        title="Выставлено, оплачено и долг"
        hint="столбики — обороты дня, линия — долг накопительно"
        days={data.series.map((p) => p.date)}
        aSeries={data.series.map((p) => p.issued_kop)}
        bSeries={data.series.map((p) => p.paid_kop)}
        lineSeries={data.series.map((p) => p.outstanding_kop)}
        aLabel="Выставлено" bLabel="Оплачено" lineLabel="Долг клиентов"
        aColor="var(--c-accent)" bColor="var(--c-success)" lineColor="var(--c-warning)"
        filter={
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={clientOptions}
            onChange={onClient}
            placeholder="Поиск клиента…"
          />
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 16, alignItems: 'start', marginTop: 16 }}>
        <AgingCard
          title="Старение долга"
          hint="по дням просрочки"
          buckets={data.aging}
          total={agingTotal}
          colorOf={agingTone}
        />

        <div className="an-card">
          <div className="an-card-head">
            <div className="an-card-ico"><Icon name="users" size={14} /></div>
            <span className="an-card-title">Должники</span>
            <span className="an-card-hint">
              {data.clients_total > data.clients.length
                ? `показаны ${data.clients.length} из ${data.clients_total}`
                : 'клик — счета клиента'}
            </span>
          </div>
          <div style={{ padding: '4px 0 8px' }}>
            {data.clients.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                За период расчётов с клиентами нет
              </div>
            ) : (
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--c-text-faint)', textAlign: 'right' }}>
                    <th style={{ fontWeight: 400, padding: '4px 14px', textAlign: 'left' }}>Клиент</th>
                    <th style={{ fontWeight: 400, padding: '4px 8px' }}>Выставлено</th>
                    <th style={{ fontWeight: 400, padding: '4px 8px' }}>Оплачено</th>
                    <th style={{ fontWeight: 400, padding: '4px 8px' }}>Долг</th>
                    <th style={{ fontWeight: 400, padding: '4px 14px' }}>Просрочка</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => (
                    <tr
                      key={c.client_id ?? c.client_name ?? 'none'}
                      onClick={() => c.client_id && onOpenClient(c.client_id, c.overdue_kop > 0)}
                      style={{ cursor: c.client_id ? 'pointer' : 'default', borderTop: '1px solid var(--c-border)' }}
                    >
                      <td style={{ padding: '7px 14px' }}>{c.client_name ?? '—'}</td>
                      <td className="mono num" style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--c-text-muted)' }}>{fmtRub(c.issued_kop)}</td>
                      <td className="mono num" style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--c-success)' }}>{fmtRub(c.paid_kop)}</td>
                      <td className="mono num" style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600 }}>{fmtRub(c.debt_kop)}</td>
                      <td className="mono num" style={{ padding: '7px 14px', textAlign: 'right', color: c.overdue_kop > 0 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>
                        {c.overdue_kop > 0 ? `${fmtRub(c.overdue_kop)} · ${c.oldest_overdue_days} дн.` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function PayablesPane({ data, carrierId, carrierOptions, onCarrier, onOpenExpenses }: {
  data: PayablesAnalytics
  carrierId: string
  carrierOptions: { value: string; label: string }[]
  onCarrier: (v: string) => void
  onOpenExpenses: () => void
}) {
  const agingTotal = data.aging.reduce((s, b) => s + b.amount_kop, 0)
  const kindMax = Math.max(1, ...data.by_kind.map((k) => k.accrued_kop))
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard icon="coins" label="Начислено" value={fmtRub(data.accrued_kop)} unit="₽"
          sub={`${data.accrued_count} ${plural(data.accrued_count, 'расход', 'расхода', 'расходов')} за период`} />
        <StatCard icon="wallet" label="Выплачено" value={fmtRub(data.paid_kop)} unit="₽"
          sub={`${data.payment_count} ${plural(data.payment_count, 'выплата', 'выплаты', 'выплат')}`}
          tone="var(--c-danger)" />
        <StatCard icon="alert" label="Долг на конец" value={fmtRub(data.debt_kop)} unit="₽"
          sub={`на начало ${fmtShort(data.opening_debt_kop)}`}
          tone={data.debt_kop > 0 ? 'var(--c-warning)' : undefined} />
        <StatCard icon="timer" label="Средний срок оплаты" value={String(data.avg_days_to_pay).replace('.', ',')} unit="дн."
          sub="от даты расхода, взвешенный" />
      </div>

      <PairChart
        title="Начислено, выплачено и долг"
        hint="столбики — обороты дня, линия — долг накопительно"
        days={data.series.map((p) => p.date)}
        aSeries={data.series.map((p) => p.accrued_kop)}
        bSeries={data.series.map((p) => p.paid_kop)}
        lineSeries={data.series.map((p) => p.outstanding_kop)}
        aLabel="Начислено" bLabel="Выплачено" lineLabel="Долг поставщикам"
        aColor="var(--c-info)" bColor="var(--c-danger)" lineColor="var(--c-warning)"
        filter={
          <FilterCombobox
            label="Перевозчик"
            value={carrierId}
            options={carrierOptions}
            onChange={onCarrier}
            placeholder="Поиск перевозчика…"
          />
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 16, alignItems: 'start', marginTop: 16 }}>
        <AgingCard
          title="Возраст долга"
          hint="срока оплаты у расхода нет — считаем от даты расхода"
          buckets={data.aging}
          total={agingTotal}
          colorOf={agingTone}
        />

        <div className="an-card">
          <div className="an-card-head">
            <div className="an-card-ico"><Icon name="truckRoute" size={14} /></div>
            <span className="an-card-title">Кому должны</span>
            <span className="an-card-hint">
              {data.counterparties_total > data.counterparties.length
                ? `показаны ${data.counterparties.length} из ${data.counterparties_total}`
                : 'перевозчик или поставщик расхода'}
            </span>
          </div>
          <div style={{ padding: '4px 0 8px' }}>
            {data.counterparties.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                За период расчётов с контрагентами нет
              </div>
            ) : (
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--c-text-faint)', textAlign: 'right' }}>
                    <th style={{ fontWeight: 400, padding: '4px 14px', textAlign: 'left' }}>Контрагент</th>
                    <th style={{ fontWeight: 400, padding: '4px 8px' }}>Начислено</th>
                    <th style={{ fontWeight: 400, padding: '4px 8px' }}>Выплачено</th>
                    <th style={{ fontWeight: 400, padding: '4px 8px' }}>Долг</th>
                    <th style={{ fontWeight: 400, padding: '4px 14px' }}>Возраст</th>
                  </tr>
                </thead>
                <tbody>
                  {data.counterparties.map((c) => (
                    <tr key={c.key || c.name} style={{ borderTop: '1px solid var(--c-border)' }}>
                      <td style={{ padding: '7px 14px' }}>{c.name}</td>
                      <td className="mono num" style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--c-text-muted)' }}>{fmtRub(c.accrued_kop)}</td>
                      <td className="mono num" style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--c-danger)' }}>{fmtRub(c.paid_kop)}</td>
                      <td className="mono num" style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600 }}>{fmtRub(c.debt_kop)}</td>
                      <td className="mono num" style={{ padding: '7px 14px', textAlign: 'right', color: c.oldest_days > 30 ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>
                        {c.debt_kop > 0 ? `${c.oldest_days} дн.` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <div className="an-card" style={{ marginTop: 16 }}>
        <div className="an-card-head">
          <div className="an-card-ico"><Icon name="layers" size={14} /></div>
          <span className="an-card-title">По видам расхода</span>
          <button className="mini-btn" style={{ marginLeft: 'auto' }} onClick={onOpenExpenses}>Реестр расходов →</button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.by_kind.length === 0 ? (
            <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет данных</div>
          ) : data.by_kind.map((k) => (
            <div key={k.kind}>
              <div className="bd-top">
                <span className="bd-name"><span className="nm">{k.kind_label}</span></span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600, flexShrink: 0 }}>
                  {fmtRub(k.accrued_kop)}
                  {k.debt_kop > 0 && <span style={{ color: 'var(--c-warning)', marginLeft: 8 }}>долг {fmtShort(k.debt_kop)}</span>}
                </span>
              </div>
              <div className="prog" style={{ height: 7 }}>
                <div className="prog-fill" style={{ width: `${Math.round((k.accrued_kop / kindMax) * 100)}%`, background: 'var(--c-info)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/** Бакет старения красится по «возрасту»: чем дальше от начала списка, тем тревожнее. */
function agingTone(key: string): string {
  if (key === 'current' || key === 'd0_7') return 'var(--c-success)'
  if (key === 'd1_7' || key === 'd8_30') return 'var(--c-warning)'
  if (key === 'd31_60') return 'var(--c-danger)'
  return 'var(--c-danger)'
}

function AgingCard({ title, hint, buckets, total, colorOf }: {
  title: string
  hint: string
  buckets: SettlementAgingBucket[]
  total: number
  colorOf: (key: string) => string
}) {
  const max = Math.max(1, ...buckets.map((b) => b.amount_kop))
  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-ico"><Icon name="history" size={14} /></div>
        <span className="an-card-title">{title}</span>
        <span className="an-card-hint">{hint}</span>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {total === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>Непогашенных обязательств нет</div>
        ) : buckets.map((b) => {
          const share = total > 0 ? Math.round((b.amount_kop / total) * 100) : 0
          return (
            <div key={b.key}>
              <div className="bd-top">
                <span className="bd-name">
                  <span className="lrow-sw" style={{ background: colorOf(b.key) }} />
                  <span className="nm">{b.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--c-text-faint)', flexShrink: 0 }}>· {b.count} · {share}%</span>
                </span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-muted)', fontWeight: 600, flexShrink: 0 }}>{fmtRub(b.amount_kop)}</span>
              </div>
              <div className="prog" style={{ height: 7 }}>
                <div className="prog-fill" style={{ width: `${Math.round((b.amount_kop / max) * 100)}%`, background: colorOf(b.key) }} />
              </div>
            </div>
          )
        })}
        {total > 0 && (
          <div style={{ marginTop: 2, paddingTop: 12, borderTop: '1px solid var(--c-border)', display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--c-text-muted)' }}>Итого долг</span>
            <span className="mono" style={{ fontWeight: 700 }}>{fmtRub(total)} ₽</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Парные столбики оборотов дня + линия накопительного долга по той же оси. */
function PairChart({
  title, hint, days, aSeries, bSeries, lineSeries,
  aLabel, bLabel, lineLabel, aColor, bColor, lineColor, filter,
}: {
  title: string
  hint: string
  days: string[]
  aSeries: number[]
  bSeries: number[]
  lineSeries: number[]
  aLabel: string
  bLabel: string
  lineLabel: string
  aColor: string
  bColor: string
  lineColor: string
  filter?: React.ReactNode
}) {
  const [hoverDay, setHoverDay] = useState<number | null>(null)
  const [tipX, setTipX] = useState(0)
  const plotRef = useRef<HTMLDivElement>(null)

  const barPeak = Math.max(0, ...aSeries, ...bSeries)
  const axisMax = niceMax(barPeak)
  const lineMax = niceMax(Math.max(0, ...lineSeries))
  const gridVals = [1, 0.75, 0.5, 0.25].map((f) => axisMax * f)
  const labelEvery = Math.max(1, Math.ceil(days.length / 15))

  // Линия долга живёт в своём масштабе (долг на порядок больше дневных оборотов) —
  // общая ось сплющила бы столбики в ноль. Подпись правой шкалы это проговаривает.
  const linePoints = days.length > 1
    ? lineSeries.map((v, i) => `${((i + 0.5) / days.length * 100).toFixed(2)},${((1 - v / lineMax) * 100).toFixed(2)}`).join(' ')
    : ''

  const plotWidth = () => plotRef.current?.clientWidth || 600

  return (
    <div className="an-card">
      <div className="an-card-head">
        <div className="an-card-ico"><Icon name="chart" size={14} /></div>
        <span className="an-card-title">{title}</span>
        <span className="an-card-hint" style={{ marginLeft: 8, marginRight: 'auto' }}>{hint}</span>
        {filter}
      </div>
      <div style={{ padding: '14px 14px 10px', display: 'flex', flexDirection: 'column', height: 340 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, fontSize: 11.5, color: 'var(--c-text-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="lrow-sw" style={{ background: aColor }} />{aLabel}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className="lrow-sw" style={{ background: bColor }} />{bLabel}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 16, height: 0, borderTop: `2px solid ${lineColor}` }} />{lineLabel}
            <span style={{ color: 'var(--c-text-faint)' }}>· своя шкала, максимум {fmtShort(lineMax)}</span>
          </span>
        </div>

        <div className="plot" ref={plotRef}
          onMouseMove={(e) => {
            const r = plotRef.current?.getBoundingClientRect()
            if (r) setTipX(e.clientX - r.left)
          }}
          onMouseLeave={() => setHoverDay(null)}
        >
          {gridVals.map((gv, i) => (
            <div key={i} className="gridline" style={{ top: `${(1 - gv / axisMax) * 100}%` }}>
              <span className="yl">{fmtShort(gv)}</span>
            </div>
          ))}
          <div className="gridline" style={{ top: '100%' }}><span className="yl">0</span></div>

          <div className="bars">
            {days.map((day, di) => (
              <div key={day} className={`bcol${hoverDay === di ? ' sel' : ''}`} onMouseEnter={() => setHoverDay(di)}>
                <div className="pair-col">
                  <div className="pair-bar" style={{ height: `${axisMax > 0 ? (aSeries[di] / axisMax) * 100 : 0}%`, background: aColor }} />
                  <div className="pair-bar" style={{ height: `${axisMax > 0 ? (bSeries[di] / axisMax) * 100 : 0}%`, background: bColor }} />
                </div>
              </div>
            ))}
          </div>

          {linePoints && (
            <svg className="debt-line" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline points={linePoints} fill="none" stroke={lineColor} strokeWidth={2}
                vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          )}

          {hoverDay != null && (
            <div className="an-tip" style={{
              left: Math.max(96, Math.min(tipX, plotWidth() - 8)), top: 4,
              transform: tipX > plotWidth() - 130 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}>
              <div className="an-tip-date">{fmtDayFull(days[hoverDay])}</div>
              <div className="an-tip-row">
                <span className="an-tip-sw" style={{ background: aColor }} />
                <span className="an-tip-nm">{aLabel}</span>
                <span className="an-tip-vl">{fmtRub(aSeries[hoverDay])}</span>
              </div>
              <div className="an-tip-row">
                <span className="an-tip-sw" style={{ background: bColor }} />
                <span className="an-tip-nm">{bLabel}</span>
                <span className="an-tip-vl">{fmtRub(bSeries[hoverDay])}</span>
              </div>
              <div className="an-tip-row">
                <span className="an-tip-sw" style={{ background: lineColor }} />
                <span className="an-tip-nm">{lineLabel}</span>
                <span className="an-tip-vl">{fmtRub(lineSeries[hoverDay])}</span>
              </div>
            </div>
          )}
        </div>

        <div className="xaxis">
          {days.map((day, di) => (
            <div key={day} className="xtick">{di % labelEvery === 0 || di === days.length - 1 ? ddmm(day) : ''}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, unit, sub, tone }: {
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
