import { useState } from 'react'
import { getExtraIncome, getExtraIncomeCategories, getExtraIncomeSummary } from '../../../../api/extraIncomeApi'
import type { ExtraIncomeListItem } from '../../../../api/extraIncomeApi'
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
import { useLookups } from '../../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../../hooks/useFilterParams'
import { fmtDate, formatMoneyKopecks } from '../../../../utils/format'
import { ExtraIncomeModal } from './ExtraIncomeModal'
import { ExtraIncomeCategoriesModal } from './ExtraIncomeCategoriesModal'

const PAGE_SIZE = 25

const INVOICED_OPTIONS = [
  { value: '', label: 'Все записи' },
  { value: '0', label: 'Не выставлено' },
  { value: '1', label: 'В счёте' },
]

export function ExtraIncomeFeature() {
  const [search, setSearch] = useFilterParam('search', '')
  const [clientF, setClientF] = useFilterParam('client', '')
  const [categoryF, setCategoryF] = useFilterParam('category', '')
  const [invoicedF, setInvoicedF] = useFilterParam('invoiced', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const { clients } = useLookups()

  const [tick, setTick] = useState(0)
  const [edit, setEdit] = useState<{ entry: ExtraIncomeListItem | null } | null>(null)
  const [dictsOpen, setDictsOpen] = useState(false)

  const { data: categories } = useApi((s) => getExtraIncomeCategories(s), [tick])

  const filterParams = {
    search: search.trim() || undefined,
    client_id: clientF || undefined,
    category_id: categoryF || undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }
  const { data, loading, error } = useApi(
    (s) => getExtraIncome({
      page, limit: PAGE_SIZE, ...filterParams,
      invoiced: (invoicedF === '1' || invoicedF === '0') ? invoicedF : undefined,
    }, s),
    [page, search, clientF, categoryF, invoicedF, dateFrom, dateTo, tick],
  )
  const { data: summary } = useApi(
    (s) => getExtraIncomeSummary(filterParams, s),
    [search, clientF, categoryF, dateFrom, dateTo, tick],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const hasFilters = !!(search || clientF || categoryF || invoicedF || dateFrom || dateTo)
  const colCount = 7

  const subtitle = summary
    ? `Всего ${summary.total_count} на ${formatMoneyKopecks(summary.total_amount)}` +
      (summary.uninvoiced_count > 0
        ? ` · не выставлено ${summary.uninvoiced_count} на ${formatMoneyKopecks(summary.uninvoiced_amount)}`
        : '')
    : 'Доход за работы вне отгрузок: переборка брака, переклейка ШК и т.п.'

  return (
    <ListPage
      title="Доп. работы"
      subtitle={subtitle}
      actions={
        <>
          <button className="btn" onClick={() => setDictsOpen(true)}>
            <Icon name="book" size={14} />Виды работ
          </button>
          <button className="btn primary" onClick={() => setEdit({ entry: null })}>
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
              placeholder="Комментарий, клиент, вид…"
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
          <FilterCombobox
            label="Клиент" value={clientF}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setClientF}
            placeholder="Клиент…"
          />
          <FilterSelect
            label="Вид работы" value={categoryF}
            options={[{ value: '', label: 'Все виды' }, ...(categories ?? []).map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setCategoryF}
          />
          <FilterSelect label="Счёт" value={invoicedF} options={INVOICED_OPTIONS} onChange={setInvoicedF} />
          <DateRange
            from={dateFrom} to={dateTo}
            onFromChange={setDateFrom} onToChange={setDateTo}
            onClear={() => setMany({ from: '', to: '' })}
          />
          {hasFilters && (
            <button className="btn ghost sm" onClick={() => setMany({ search: '', client: '', category: '', invoiced: '', from: '', to: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      }
    >
      <Table>
        <thead>
          <tr>
            <th style={{ width: 100 }}>Дата</th>
            <th style={{ width: 180 }}>Вид работы</th>
            <th>Клиент</th>
            <th style={{ width: 90, textAlign: 'right' }}>Кол-во</th>
            <th style={{ width: 130, textAlign: 'right' }}>Сумма</th>
            <th style={{ width: 140 }}>Счёт</th>
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
                title="Доп. работ нет"
                sub={hasFilters ? 'По фильтрам ничего не найдено' : 'Перебрали брак или переклеили ШК — впишите работу за дату, и она попадёт в аналитику доходов'}
                action={!hasFilters ? (
                  <button className="btn primary" onClick={() => setEdit({ entry: null })}>
                    <Icon name="plus" size={14} />Добавить
                  </button>
                ) : undefined}
              />
            </td></tr>
          ) : (
            items.map((it) => (
              <tr key={it.id} onClick={() => setEdit({ entry: it })} style={{ cursor: 'pointer' }}>
                <Td className="mono">{fmtDate(it.entry_date)}</Td>
                <Td>{it.category_name ?? '—'}</Td>
                <Td>
                  <span>{it.client_name ?? '—'}</span>
                  {it.comment && <div className="t-sub" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.comment}</div>}
                </Td>
                <Td className="num">{it.qty != null ? `${it.qty} шт.` : '—'}</Td>
                <Td className="num" style={{ fontWeight: 600 }}>{formatMoneyKopecks(it.amount_kop)}</Td>
                <Td>
                  {it.invoice_number
                    ? <Badge tone="info" dot>{it.invoice_number}</Badge>
                    : <Badge tone="warning" dot>Не выставлено</Badge>}
                </Td>
                <Td><Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} /></Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      {edit && (
        <ExtraIncomeModal
          entry={edit.entry}
          categories={categories ?? []}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); setTick((t) => t + 1) }}
        />
      )}
      {dictsOpen && (
        <ExtraIncomeCategoriesModal
          onClose={() => setDictsOpen(false)}
          onChanged={() => setTick((t) => t + 1)}
        />
      )}
    </ListPage>
  )
}
