import { Fragment, useMemo, useState } from 'react'
import {
  EXPENSE_KIND_LABELS,
  EXPENSE_PAYMENT_STATUS_LABELS,
  SALARY_SUBTYPE_LABELS,
  expensePaidFraction,
  expensePaymentTone,
  getExpenseDict,
  getExpenses,
  getExpensesSummary,
  runSalaryAccruals,
  runRentAccruals,
} from '../../../../api/expensesApi'
import type { ExpenseKind, ExpenseListItem, ExpenseSummaryBreakdown } from '../../../../api/expensesApi'
import { getEmployees } from '../../../../api/timesheetApi'
import { fetchSimpleDictionaryPage } from '../../../../api/adminApi'
import { moscowTodayYmd, parseMoscow, MOSCOW_TZ } from '../../../../utils/format'
import { ListPage } from '../../../layouts/ListPage'
import { Table, Td } from '../../../data/Table'
import { Pagination } from '../../../data/Pagination'
import { FiltersBar, FilterSelect, FilterCombobox } from '../../../data/FiltersBar'
import { DateRange } from '../../../data/DateRange'
import { Badge } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { EmptyState } from '../../../primitives/EmptyState'
import { useApi } from '../../../../hooks/useApi'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { useToast } from '../../../feedback/Toast'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../../hooks/useFilterParams'
import { canManageAdminFinance } from '../../../../utils/access'
import { formatMoneyKopecks } from '../../../../utils/format'
import { Kpi, kpiMoney } from '../financeUI'
import { ExpenseModal } from './ExpenseModal'
import { ExpenseDictsModal } from './ExpenseDictsModal'
import { SalaryRosterModal } from './SalaryRosterModal'
import { RentRosterModal } from './RentRosterModal'
import { CarrierPaymentModal } from './CarrierPaymentModal'
import { RecurringPaymentModal } from './RecurringPaymentModal'

const PAGE_SIZE = 25

/** Метаданные текущего календарного месяца для плашки средних трат.
 *  Рабочий день — любой день, кроме воскресенья (в неделе 6 рабочих дней),
 *  поэтому делитель меняется по месяцам (июнь 2026 — 26, июль 2026 — 27). */
function currentMonthMeta() {
  const [y, m1] = moscowTodayYmd().split('-').map(Number)
  const m = m1 - 1
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(y, m + 1, 0).getDate()
  let workingDays = 0
  for (let d = 1; d <= lastDay; d++) {
    if (new Date(y, m, d).getDay() !== 0) workingDays++
  }
  return {
    start: `${y}-${pad(m + 1)}-01`,
    end: `${y}-${pad(m + 1)}-${pad(lastDay)}`,
    workingDays,
    monthLabel: new Date(y, m, 1).toLocaleString('ru-RU', { month: 'long' }),
  }
}

// Операционная область расходов — для плашки «средние траты за рабочий день».
// Аренда и ЗП в среднесуточную трату не входят (это периодические фиксы).
const OPERATIONAL_KINDS: ExpenseKind[] = ['manual', 'logistics']

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'awaiting', label: EXPENSE_PAYMENT_STATUS_LABELS.awaiting },
  { value: 'partially_paid', label: EXPENSE_PAYMENT_STATUS_LABELS.partially_paid },
  { value: 'paid', label: EXPENSE_PAYMENT_STATUS_LABELS.paid },
  { value: 'cancelled', label: EXPENSE_PAYMENT_STATUS_LABELS.cancelled },
]

type ExpenseDayGroup = {
  key: string
  label: string
  count: number
  total: number
  rows: ExpenseListItem[]
}

function pluralRecords(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'запись'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'записи'
  return 'записей'
}

function ymdUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** spent_on — литеральная дата YYYY-MM-DD; день берём из неё без сдвига по поясу. */
function dayLabelOf(ymd: string, todayYmd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 'Без даты'
  const diffDays = Math.round((ymdUtcMs(ymd) - ymdUtcMs(todayYmd)) / 86_400_000)
  const rel = diffDays === 0 ? 'Сегодня' : diffDays === 1 ? 'Завтра' : diffDays === -1 ? 'Вчера' : null
  const d = parseMoscow(ymd)
  const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', timeZone: MOSCOW_TZ })
  const weekday = d.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: MOSCOW_TZ })
  return rel ? `${rel} · ${date} · ${weekday}` : `${date} · ${weekday}`
}

/** Группировка расходов по дню оплаты. Порядок дней наследуется из выдачи backend (spent_on DESC). */
function groupExpensesByDay(items: ExpenseListItem[], todayYmd: string): ExpenseDayGroup[] {
  const map = new Map<string, ExpenseDayGroup>()
  for (const it of items) {
    const key = /^\d{4}-\d{2}-\d{2}$/.test(it.spent_on) ? it.spent_on : 'no-date'
    let g = map.get(key)
    if (!g) {
      g = { key, label: dayLabelOf(it.spent_on, todayYmd), count: 0, total: 0, rows: [] }
      map.set(key, g)
    }
    g.count += 1
    g.total += it.amount
    g.rows.push(it)
  }
  return [...map.values()]
}

export function ExpensesListFeature() {
  const toast = useToast()
  const { user } = useCurrentUser()
  const isAdmin = canManageAdminFinance(user)
  // Типы, доступные роли: админ — все 4, менеджер — только хозрасходы и логистика.
  const kindOptions: ExpenseKind[] = isAdmin
    ? ['manual', 'logistics', 'rent', 'salary', 'recurring']
    : ['manual', 'logistics', 'recurring']
  const monthMeta = useMemo(() => currentMonthMeta(), [])

  const [search, setSearch] = useFilterParam('search', '')
  const [categoryF, setCategoryF] = useFilterParam('category', '')
  const [sourceF, setSourceF] = useFilterParam('source', '')
  const [statusF, setStatusF] = useFilterParam('pstatus', '')
  const [kindF, setKindF] = useFilterParam('kind', '')
  const [salSubF, setSalSubF] = useFilterParam('salsub', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

  // Активный тип в фильтре задаёт первичное действие: логистика заводится из рейса
  // (создавать нельзя), аренда/ЗП — только под фильтром нужного типа, иначе хозрасход.
  const selectedKind: ExpenseKind | '' =
    kindOptions.includes(kindF as ExpenseKind) ? (kindF as ExpenseKind) : ''
  const isSalaryMode = selectedKind === 'salary'
  const isRentMode = selectedKind === 'rent'
  // Логистика заводится из рейса, регулярный — из справочника «Регулярные расходы»;
  // вручную в реестре их не создают.
  const createKind: ExpenseKind | null =
    selectedKind === 'logistics' ? null
      : selectedKind === 'recurring' ? null
        : selectedKind === 'rent' ? 'rent'
          : selectedKind === 'salary' ? 'salary'
            : 'manual'
  const canCreate = createKind != null
  const createLabel =
    createKind === 'rent' ? 'Добавить оплату аренды'
      : createKind === 'salary' ? 'Выплатить ЗП'
        : 'Добавить расход'

  const [dictTick, setDictTick] = useState(0)
  const [dataTick, setDataTick] = useState(0)
  const [edit, setEdit] = useState<{ id: string | null } | null>(null)
  const [dictsOpen, setDictsOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [rentRosterOpen, setRentRosterOpen] = useState(false)
  const [carrierPayOpen, setCarrierPayOpen] = useState(false)
  const [recurringPayOpen, setRecurringPayOpen] = useState(false)

  const [accruing, setAccruing] = useState(false)

  const { data: categories } = useApi((s) => getExpenseDict('categories', s), [dictTick])
  const { data: paymentSources } = useApi((s) => getExpenseDict('payment-sources', s), [dictTick])
  const { data: empList } = useApi(
    (s) => (isSalaryMode ? getEmployees({ status: 'active' }, s) : Promise.resolve(null)),
    [isSalaryMode],
  )
  const { data: warehouseList } = useApi(
    () => (isRentMode ? fetchSimpleDictionaryPage('/own-warehouses', 'name', { page: 1, limit: 100 }) : Promise.resolve(null)),
    [isRentMode],
  )
  const cats = categories ?? []
  const srcs = paymentSources ?? []
  const salaryEmployees = (empList?.items ?? []).map((e) => ({
    id: e.id, full_name: e.full_name, comp_type: e.comp_type, fixed_salary_kopecks: e.fixed_salary_kopecks,
  }))

  function runAccruals() {
    setAccruing(true)
    runSalaryAccruals()
      .then((r) => { toast(`Начислено оплат: ${r.created}`, 'success'); setDataTick((t) => t + 1) })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setAccruing(false))
  }

  function runRent() {
    setAccruing(true)
    runRentAccruals()
      .then((r) => { toast(`Начислено оплат: ${r.created}`, 'success'); setDataTick((t) => t + 1) })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setAccruing(false))
  }

  const filters = {
    search: search.trim() || undefined,
    category_id: categoryF || undefined,
    payment_source_id: sourceF || undefined,
    payment_status: statusF || undefined,
    kind: selectedKind || undefined,
    salary_subtype: (isSalaryMode && salSubF) || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }
  const filterDeps = [search, categoryF, sourceF, statusF, kindF, salSubF, dateFrom, dateTo, dataTick]

  const { data, loading, error } = useApi(
    (s) => getExpenses({ ...filters, page, limit: PAGE_SIZE }, s),
    [page, ...filterDeps],
  )
  const { data: summary } = useApi((s) => getExpensesSummary(filters, s), filterDeps)

  // Плашка «за рабочий день»: область = выбранный тип, иначе операционные
  // (хозрасходы + логистика). Так аренда/ЗП дают суточную трату только под своим фильтром.
  const dailyKinds: ExpenseKind[] = selectedKind ? [selectedKind] : OPERATIONAL_KINDS
  const dailyKindsKey = dailyKinds.join(',')
  const dailyLabel =
    selectedKind === 'salary' ? 'ЗП за раб. день'
      : selectedKind === 'rent' ? 'Аренда за раб. день'
        : selectedKind === 'logistics' ? 'Логистика за день'
          : selectedKind === 'manual' ? 'Хозрасходы за день'
            : 'Операц. за раб. день'
  const { data: monthSummary } = useApi(
    (s) => getExpensesSummary(
      { kinds: dailyKindsKey, date_from: monthMeta.start, date_to: monthMeta.end },
      s,
    ),
    [dailyKindsKey, monthMeta.start, monthMeta.end, dataTick],
  )
  const monthActive = monthSummary ? monthSummary.awaiting_amount + monthSummary.paid_amount : 0
  const perWorkingDay = monthMeta.workingDays > 0 ? Math.round(monthActive / monthMeta.workingDays) : 0

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const dayGroups = useMemo(() => groupExpensesByDay(items, moscowTodayYmd()), [items])
  const hasFilters = !!(search || categoryF || sourceF || statusF || kindF || salSubF || dateFrom || dateTo)
  const colCount = 7

  function afterSave() {
    setEdit(null)
    setDataTick((t) => t + 1)
  }

  return (
    <ListPage
      title="Расходы"
      subtitle={`${isAdmin ? 'Хозрасходы, логистика, аренда, ЗП' : 'Хозрасходы и логистика'} · всего ${total}`}
      actions={
        <>
          <button className="btn" onClick={() => setDictsOpen(true)}>
            <Icon name="book" size={14} />Справочники
          </button>
          <button className="btn" onClick={() => setCarrierPayOpen(true)} title="Внести оплату перевозчику одной суммой — распределится по его логистическим расходам">
            <Icon name="wallet" size={14} />Оплата перевозчику
          </button>
          <button className="btn" onClick={() => setRecurringPayOpen(true)} title="Оплатить регулярный расход одной суммой — распределится по его начислениям от ранних к поздним">
            <Icon name="refresh" size={14} />Оплата регулярного
          </button>
          {isSalaryMode && (
            <button className="btn" onClick={() => setRosterOpen(true)} title="Сотрудники на окладе и месячный фонд по ним">
              <Icon name="users" size={14} />На окладе
            </button>
          )}
          {isRentMode && (
            <button className="btn" onClick={() => setRentRosterOpen(true)} title="Склады в аренде и месячная стоимость аренды по ним">
              <Icon name="building" size={14} />В аренде
            </button>
          )}
          {isSalaryMode && (
            <button className="btn" onClick={runAccruals} disabled={accruing} title="Начислить оклады за сегодня (15-е / последний день месяца)">
              <Icon name={accruing ? 'refresh' : 'calendar'} size={14} />Начислить
            </button>
          )}
          {isRentMode && (
            <button className="btn" onClick={runRent} disabled={accruing} title="Доначислить аренду складов за текущий месяц (по складам со ставкой аренды)">
              <Icon name={accruing ? 'refresh' : 'calendar'} size={14} />Доначислить
            </button>
          )}
          {canCreate && (
            <button className="btn primary" onClick={() => setEdit({ id: null })}>
              <Icon name="plus" size={14} />{createLabel}
            </button>
          )}
        </>
      }
    >
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 170px 170px 180px 1fr', gap: 14, marginBottom: 14, alignItems: 'stretch' }}>
          <Kpi icon="coins" label="Итого за период" value={kpiMoney(summary.total_amount)} sub={hasFilters ? 'по текущему фильтру' : 'за всё время'} />
          <Kpi icon="clock" label="Ожидает оплаты" value={kpiMoney(summary.awaiting_amount)} sub="к оплате" tone={summary.awaiting_amount > 0 ? 'warning' : 'default'} />
          <Kpi icon="check" label="Оплачено" value={kpiMoney(summary.paid_amount)} sub="проведено" />
          <Kpi
            icon="calendar"
            label={dailyLabel}
            value={kpiMoney(perWorkingDay)}
            sub={`${monthMeta.monthLabel} · ${monthMeta.workingDays} раб. дн.`}
          />
          <BreakdownCard title="По категориям" rows={summary.by_category} total={summary.total_amount} />
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Наименование, поставщик, №…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => setSearch('')}
              ><Icon name="x" size={12} /></button>
            )}
          </div>
          {kindOptions.length > 1 && (
            <FilterSelect
              label="Тип" value={kindF}
              options={[{ value: '', label: 'Все типы' }, ...kindOptions.map((k) => ({ value: k, label: EXPENSE_KIND_LABELS[k] }))]}
              onChange={setKindF}
            />
          )}
          {isSalaryMode && (
            <FilterSelect
              label="Тип ЗП" value={salSubF}
              options={[
                { value: '', label: 'Оклад и табель' },
                { value: 'fixed', label: SALARY_SUBTYPE_LABELS.fixed },
                { value: 'timesheet', label: SALARY_SUBTYPE_LABELS.timesheet },
              ]}
              onChange={setSalSubF}
            />
          )}
          <FilterSelect label="Статус" value={statusF} options={STATUS_OPTIONS} onChange={setStatusF} />
          <FilterCombobox
            label="Категория" value={categoryF}
            options={[{ value: '', label: 'Все категории' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setCategoryF}
            placeholder="Категория…"
          />
          <FilterSelect
            label="Источник" value={sourceF}
            options={[{ value: '', label: 'Все источники' }, ...srcs.map((s) => ({ value: s.id, label: s.name }))]}
            onChange={setSourceF}
          />
          <DateRange
            from={dateFrom} to={dateTo}
            onFromChange={setDateFrom} onToChange={setDateTo}
            onClear={() => setMany({ from: '', to: '' })}
          />
          {hasFilters && (
            <button className="btn ghost sm" onClick={() => setMany({ search: '', category: '', source: '', pstatus: '', kind: '', salsub: '', from: '', to: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      </div>

      <Table>
        <thead>
          <tr>
            <th style={{ width: 96 }}>№</th>
            <th style={{ width: 120 }}>Тип</th>
            <th>Наименование</th>
            <th style={{ width: 130, textAlign: 'right' }}>Сумма</th>
            <th style={{ width: 150 }}>Статус</th>
            <th style={{ width: 130 }}>Оплата</th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={colCount} />
          ) : error ? (
            <tr><td colSpan={colCount}><EmptyState title="Не удалось загрузить расходы" sub={error.message} /></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={colCount}>
              <EmptyState
                title="Расходов нет"
                sub={hasFilters ? 'По выбранным фильтрам ничего не найдено' : 'Здесь появятся расходы'}
                action={!hasFilters && canCreate ? (
                  <button className="btn primary" onClick={() => setEdit({ id: null })}>
                    <Icon name="plus" size={14} />{createLabel}
                  </button>
                ) : undefined}
              />
            </td></tr>
          ) : (
            dayGroups.map((g) => (
              <Fragment key={g.key}>
                <tr className="list-day-row">
                  <td colSpan={colCount}>
                    <div className="list-day-head">
                      <span className="list-day-title"><Icon name="calendar" size={14} />{g.label}</span>
                      <span className="list-day-counts">
                        <span className="t-sub">{g.count} {pluralRecords(g.count)}</span>
                        <span className="t-sub">·</span>
                        <span className="mono" style={{ color: 'var(--c-text-muted)' }}>{formatMoneyKopecks(g.total)}</span>
                      </span>
                    </div>
                  </td>
                </tr>
                {g.rows.map((it) => (
              <tr key={it.id} style={{ cursor: 'pointer' }} onClick={() => setEdit({ id: it.id })}>
                <Td><span className="mono" style={{ fontSize: 12 }}>{it.exp_number}</span></Td>
                <Td>
                  <span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{it.kind_label}</span>
                  {it.salary_subtype_label && <div className="t-sub">{it.salary_subtype_label}</div>}
                </Td>
                <Td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {it.name}
                    {it.file_count > 0 && <Icon name="paperclip" size={12} style={{ color: 'var(--c-text-faint)' }} />}
                  </span>
                  {it.supplier && <div className="t-sub">{it.supplier}</div>}
                </Td>
                <Td className="num" style={{ fontWeight: 600 }}>{formatMoneyKopecks(it.amount)}</Td>
                <Td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start' }}>
                    <Badge tone={expensePaymentTone(it.payment_status)} dot>{it.payment_status_label}</Badge>
                    {it.payment_status === 'partially_paid' && (
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 7 }}
                        title={`Оплачено ${formatMoneyKopecks(it.paid_amount)} из ${formatMoneyKopecks(it.amount)}`}
                      >
                        <div className="prog" style={{ width: 96, height: 5 }}>
                          <div className="prog-fill ok" style={{ width: `${Math.round(expensePaidFraction(it.amount, it.paid_amount) * 100)}%` }} />
                        </div>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>
                          {Math.round(expensePaidFraction(it.amount, it.paid_amount) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </Td>
                <Td><span style={{ fontSize: 12.5 }}>{it.payment_source_name ?? '—'}</span></Td>
                <Td><Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} /></Td>
              </tr>
                ))}
              </Fragment>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      {edit && (
        <ExpenseModal
          expenseId={edit.id}
          createKind={createKind ?? 'manual'}
          categories={cats}
          paymentSources={srcs}
          employees={isSalaryMode ? salaryEmployees : undefined}
          onClose={() => setEdit(null)}
          onSaved={afterSave}
          onManageDicts={() => setDictsOpen(true)}
        />
      )}
      {dictsOpen && (
        <ExpenseDictsModal
          onClose={() => setDictsOpen(false)}
          onChanged={() => setDictTick((t) => t + 1)}
        />
      )}
      {rosterOpen && (
        <SalaryRosterModal employees={empList?.items ?? []} onClose={() => setRosterOpen(false)} />
      )}
      {rentRosterOpen && (
        <RentRosterModal warehouses={warehouseList?.items ?? []} onClose={() => setRentRosterOpen(false)} />
      )}
      {carrierPayOpen && (
        <CarrierPaymentModal
          paymentSources={srcs}
          onClose={() => setCarrierPayOpen(false)}
          onPaid={() => { setCarrierPayOpen(false); setDataTick((t) => t + 1) }}
        />
      )}
      {recurringPayOpen && (
        <RecurringPaymentModal
          paymentSources={srcs}
          onClose={() => setRecurringPayOpen(false)}
          onPaid={() => { setRecurringPayOpen(false); setDataTick((t) => t + 1) }}
        />
      )}
    </ListPage>
  )
}

function BreakdownCard({ title, rows, total }: { title: string; rows: ExpenseSummaryBreakdown[]; total: number }) {
  const top = rows.slice(0, 4)
  return (
    <div className="kpi" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="kpi-label">{title}</span>
      {top.length === 0 ? (
        <span style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>—</span>
      ) : top.map((r, i) => {
        const pct = total > 0 ? Math.round((r.amount / total) * 100) : 0
        return (
          <div key={r.id ?? `none-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <div className="prog" style={{ width: 40, height: 5, flexShrink: 0 }}>
              <div className="prog-fill warn" style={{ width: `${pct}%` }} />
            </div>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--c-text-muted)', minWidth: 64, textAlign: 'right' }}>{formatMoneyKopecks(r.amount)}</span>
          </div>
        )
      })}
    </div>
  )
}
