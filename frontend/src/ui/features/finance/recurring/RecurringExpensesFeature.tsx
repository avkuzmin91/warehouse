import { useState } from 'react'
import { getRecurringTemplates, runRecurringAccruals } from '../../../../api/recurringExpensesApi'
import { getExpenseDict } from '../../../../api/expensesApi'
import { ListPage } from '../../../layouts/ListPage'
import { Table, Td } from '../../../data/Table'
import { Pagination } from '../../../data/Pagination'
import { FiltersBar } from '../../../data/FiltersBar'
import { Badge } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { EmptyState } from '../../../primitives/EmptyState'
import { useApi } from '../../../../hooks/useApi'
import { useToast } from '../../../feedback/Toast'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../../hooks/useFilterParams'
import { formatMoneyKopecks } from '../../../../utils/format'
import { RecurringExpenseDrawer } from './RecurringExpenseDrawer'

const PAGE_SIZE = 25

export function RecurringExpensesFeature() {
  const toast = useToast()
  const [search, setSearch] = useFilterParam('search', '')
  const [activeOnly, setActiveOnly] = useFilterParam('active', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const [tick, setTick] = useState(0)
  const [edit, setEdit] = useState<{ id: string | null } | null>(null)
  const [accruing, setAccruing] = useState(false)

  const { data: categories } = useApi((s) => getExpenseDict('categories', s), [])
  const { data: paymentSources } = useApi((s) => getExpenseDict('payment-sources', s), [])

  const { data, loading, error } = useApi(
    (s) => getRecurringTemplates({
      page, limit: PAGE_SIZE,
      search: search.trim() || undefined,
      active_only: activeOnly === '1' || undefined,
    }, s),
    [page, search, activeOnly, tick],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const hasFilters = !!(search || activeOnly)
  const colCount = 5

  function describeSchedule(it: typeof items[number]): string {
    if (it.frequency === 'monthly') return `${it.frequency_label} · ${it.month_day}-го числа`
    return it.frequency_label
  }

  function runToday() {
    setAccruing(true)
    runRecurringAccruals()
      .then((r) => { toast(`Начислено расходов: ${r.created}`, 'success'); setTick((t) => t + 1) })
      .catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))
      .finally(() => setAccruing(false))
  }

  return (
    <ListPage
      title="Регулярные расходы"
      subtitle={`Шаблоны автоначислений · всего ${total}`}
      actions={
        <>
          <button className="btn" onClick={runToday} disabled={accruing} title="Начислить активные расходы за сегодня (обычно делает планировщик автоматически)">
            <Icon name={accruing ? 'refresh' : 'calendar'} size={14} />Начислить за сегодня
          </button>
          <button className="btn primary" onClick={() => setEdit({ id: null })}>
            <Icon name="plus" size={14} />Добавить
          </button>
        </>
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Название…"
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
          <button
            className={`btn sm${activeOnly === '1' ? ' primary' : ' ghost'}`}
            onClick={() => setActiveOnly(activeOnly === '1' ? '' : '1')}
            title="Только активные шаблоны"
          >
            <Icon name="check" size={13} />Только активные
          </button>
          {hasFilters && (
            <button className="btn ghost sm" onClick={() => setMany({ search: '', active: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      }
    >
      <Table>
        <thead>
          <tr>
            <th>Название</th>
            <th style={{ width: 220 }}>Расписание</th>
            <th style={{ width: 160, textAlign: 'right' }}>Стоимость</th>
            <th style={{ width: 120 }}>Статус</th>
            <th style={{ width: 28 }} />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={colCount} />
          ) : error ? (
            <tr><td colSpan={colCount}><EmptyState title="Не удалось загрузить" sub={error.message} /></td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={colCount}>
              <EmptyState
                title="Регулярных расходов нет"
                sub={hasFilters ? 'По фильтрам ничего не найдено' : 'Добавьте повторяющийся расход, чтобы не вносить его вручную каждый день'}
                action={!hasFilters ? (
                  <button className="btn primary" onClick={() => setEdit({ id: null })}>
                    <Icon name="plus" size={14} />Добавить
                  </button>
                ) : undefined}
              />
            </td></tr>
          ) : (
            items.map((it) => (
              <tr key={it.id} onClick={() => setEdit({ id: it.id })} style={{ cursor: 'pointer', opacity: it.is_active ? 1 : 0.6 }}>
                <Td>
                  <span>{it.name}</span>
                  {it.category_name && <div className="t-sub">{it.category_name}</div>}
                </Td>
                <Td><span style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{describeSchedule(it)}</span></Td>
                <Td className="num" style={{ fontWeight: 600, color: it.current_amount_kop != null ? 'var(--c-text)' : 'var(--c-text-faint)' }}>
                  {it.current_amount_kop != null ? formatMoneyKopecks(it.current_amount_kop) : '— нет ставки'}
                </Td>
                <Td>
                  {it.is_active
                    ? <Badge tone="success" dot>Активен</Badge>
                    : <Badge tone="" dot>Выключен</Badge>}
                </Td>
                <Td><Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} /></Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      {edit && (
        <RecurringExpenseDrawer
          templateId={edit.id}
          categories={categories ?? []}
          paymentSources={paymentSources ?? []}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); setTick((t) => t + 1) }}
        />
      )}
    </ListPage>
  )
}
