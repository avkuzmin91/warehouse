import { useState } from 'react'
import {
  EXPENSE_KIND_LABELS,
  EXPENSE_PAYMENT_STATUS_LABELS,
  expensePaymentTone,
  getExpenseDict,
  getExpenses,
  getExpensesSummary,
  runSalaryAccruals,
} from '../../../../api/expensesApi'
import type { ExpenseKind, ExpenseSummaryBreakdown } from '../../../../api/expensesApi'
import { getEmployees } from '../../../../api/timesheetApi'
import { ListPage } from '../../../layouts/ListPage'
import { Table, Td } from '../../../data/Table'
import { Pagination } from '../../../data/Pagination'
import { FiltersBar, FilterSelect } from '../../../data/FiltersBar'
import { DateRange } from '../../../data/DateRange'
import { Badge } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { EmptyState } from '../../../primitives/EmptyState'
import { useApi } from '../../../../hooks/useApi'
import { useToast } from '../../../feedback/Toast'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../../hooks/useFilterParams'
import { fmtDate, formatMoneyKopecks } from '../../../../utils/format'
import { Kpi, kpiMoney } from '../financeUI'
import { ExpenseModal } from './ExpenseModal'
import { ExpenseDictsModal } from './ExpenseDictsModal'
import { SalaryRosterModal } from './SalaryRosterModal'

const PAGE_SIZE = 25

export type LedgerVariant = {
  title: string
  subtitle?: string
  kindScope?: ExpenseKind[]        // request kinds=... (область); undefined — все видимые
  showKind?: boolean               // колонка и фильтр «Тип»
  createKind?: ExpenseKind | null  // тип для «Добавить»; null — без создания
  createLabel?: string
}

const OPERATIONAL: LedgerVariant = {
  title: 'Расходы',
  subtitle: 'Хозрасходы и логистика',
  kindScope: ['manual', 'logistics'],
  showKind: true,
  createKind: 'manual',
  createLabel: 'Добавить расход',
}

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'awaiting', label: EXPENSE_PAYMENT_STATUS_LABELS.awaiting },
  { value: 'paid', label: EXPENSE_PAYMENT_STATUS_LABELS.paid },
  { value: 'cancelled', label: EXPENSE_PAYMENT_STATUS_LABELS.cancelled },
]

export function ExpensesListFeature({ variant = OPERATIONAL }: { variant?: LedgerVariant }) {
  const toast = useToast()
  const showKind = variant.showKind ?? false
  const kindOptions: ExpenseKind[] = variant.kindScope ?? ['manual', 'logistics', 'rent', 'salary']
  const canCreate = variant.createKind != null
  const isSalaryVariant = variant.createKind === 'salary'

  const [search, setSearch] = useFilterParam('search', '')
  const [categoryF, setCategoryF] = useFilterParam('category', '')
  const [sourceF, setSourceF] = useFilterParam('source', '')
  const [statusF, setStatusF] = useFilterParam('pstatus', '')
  const [kindF, setKindF] = useFilterParam('kind', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()

  const [dictTick, setDictTick] = useState(0)
  const [dataTick, setDataTick] = useState(0)
  const [edit, setEdit] = useState<{ id: string | null } | null>(null)
  const [dictsOpen, setDictsOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)

  const [accruing, setAccruing] = useState(false)

  const { data: categories } = useApi((s) => getExpenseDict('categories', s), [dictTick])
  const { data: paymentSources } = useApi((s) => getExpenseDict('payment-sources', s), [dictTick])
  const { data: empList } = useApi(
    (s) => (isSalaryVariant ? getEmployees({ status: 'active' }, s) : Promise.resolve(null)),
    [isSalaryVariant],
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

  const filters = {
    search: search.trim() || undefined,
    category_id: categoryF || undefined,
    payment_source_id: sourceF || undefined,
    payment_status: statusF || undefined,
    kind: showKind && kindF ? kindF : undefined,
    kinds: variant.kindScope ? variant.kindScope.join(',') : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }
  const filterDeps = [search, categoryF, sourceF, statusF, kindF, dateFrom, dateTo, dataTick]

  const { data, loading, error } = useApi(
    (s) => getExpenses({ ...filters, page, limit: PAGE_SIZE }, s),
    [page, ...filterDeps],
  )
  const { data: summary } = useApi((s) => getExpensesSummary(filters, s), filterDeps)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const hasFilters = !!(search || categoryF || sourceF || statusF || kindF || dateFrom || dateTo)
  const colCount = showKind ? 8 : 7

  function afterSave() {
    setEdit(null)
    setDataTick((t) => t + 1)
  }

  return (
    <ListPage
      title={variant.title}
      subtitle={`${variant.subtitle ?? ''} · всего ${total}`}
      actions={
        <>
          <button className="btn" onClick={() => setDictsOpen(true)}>
            <Icon name="book" size={14} />Справочники
          </button>
          {isSalaryVariant && (
            <button className="btn" onClick={() => setRosterOpen(true)} title="Сотрудники на окладе и месячный фонд по ним">
              <Icon name="users" size={14} />На окладе
            </button>
          )}
          {isSalaryVariant && (
            <button className="btn" onClick={runAccruals} disabled={accruing} title="Начислить оклады за сегодня (15-е / последний день месяца)">
              <Icon name={accruing ? 'refresh' : 'calendar'} size={14} />Начислить
            </button>
          )}
          {canCreate && (
            <button className="btn primary" onClick={() => setEdit({ id: null })}>
              <Icon name="plus" size={14} />{variant.createLabel ?? 'Добавить'}
            </button>
          )}
        </>
      }
    >
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: '200px 170px 170px 1fr', gap: 14, marginBottom: 14, alignItems: 'stretch' }}>
          <Kpi icon="coins" label="Итого за период" value={kpiMoney(summary.total_amount)} sub={hasFilters ? 'по текущему фильтру' : 'за всё время'} />
          <Kpi icon="clock" label="Ожидает оплаты" value={kpiMoney(summary.awaiting_amount)} sub="к оплате" tone={summary.awaiting_amount > 0 ? 'warning' : 'default'} />
          <Kpi icon="check" label="Оплачено" value={kpiMoney(summary.paid_amount)} sub="проведено" />
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
          {showKind && kindOptions.length > 1 && (
            <FilterSelect
              label="Тип" value={kindF}
              options={[{ value: '', label: 'Все типы' }, ...kindOptions.map((k) => ({ value: k, label: EXPENSE_KIND_LABELS[k] }))]}
              onChange={setKindF}
            />
          )}
          <FilterSelect label="Статус" value={statusF} options={STATUS_OPTIONS} onChange={setStatusF} />
          <FilterSelect
            label="Категория" value={categoryF}
            options={[{ value: '', label: 'Все категории' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setCategoryF}
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
            <button className="btn ghost sm" onClick={() => setMany({ search: '', category: '', source: '', pstatus: '', kind: '', from: '', to: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      </div>

      <Table>
        <thead>
          <tr>
            <th style={{ width: 96 }}>Дата</th>
            <th style={{ width: 96 }}>№</th>
            {showKind && <th style={{ width: 120 }}>Тип</th>}
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
                    <Icon name="plus" size={14} />{variant.createLabel ?? 'Добавить'}
                  </button>
                ) : undefined}
              />
            </td></tr>
          ) : (
            items.map((it) => (
              <tr key={it.id} onClick={() => setEdit({ id: it.id })}>
                <Td><span className="mono" style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>{fmtDate(it.spent_on)}</span></Td>
                <Td><span className="mono" style={{ fontSize: 12 }}>{it.exp_number}</span></Td>
                {showKind && <Td><span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{it.kind_label}</span></Td>}
                <Td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {it.name}
                    {it.file_count > 0 && <Icon name="paperclip" size={12} style={{ color: 'var(--c-text-faint)' }} />}
                  </span>
                  {it.supplier && <div className="t-sub">{it.supplier}</div>}
                </Td>
                <Td className="num" style={{ fontWeight: 600 }}>{formatMoneyKopecks(it.amount)}</Td>
                <Td><Badge tone={expensePaymentTone(it.payment_status)} dot>{it.payment_status_label}</Badge></Td>
                <Td><span style={{ fontSize: 12.5 }}>{it.payment_source_name ?? '—'}</span></Td>
                <Td><Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} /></Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      {edit && (
        <ExpenseModal
          expenseId={edit.id}
          createKind={variant.createKind ?? 'manual'}
          categories={cats}
          paymentSources={srcs}
          employees={isSalaryVariant ? salaryEmployees : undefined}
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
