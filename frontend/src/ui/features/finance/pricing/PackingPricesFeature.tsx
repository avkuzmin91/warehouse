import { useState } from 'react'
import { getPricedProducts } from '../../../../api/pricingApi'
import { ListPage } from '../../../layouts/ListPage'
import { Table, Td } from '../../../data/Table'
import { Pagination } from '../../../data/Pagination'
import { FiltersBar, FilterCombobox } from '../../../data/FiltersBar'
import { Badge } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { EmptyState } from '../../../primitives/EmptyState'
import { useApi } from '../../../../hooks/useApi'
import { useLookups } from '../../../../hooks/useLookups'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../../hooks/useFilterParams'
import { formatMoneyKopecks } from '../../../../utils/format'
import { PackingPriceDrawer } from './PackingPriceDrawer'

const PAGE_SIZE = 25

export function PackingPricesFeature() {
  const { clients } = useLookups()
  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [missing, setMissing] = useFilterParam('missing', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const [tick, setTick] = useState(0)
  const [editId, setEditId] = useState<string | null>(null)

  const { data, loading, error } = useApi(
    (s) => getPricedProducts({
      page, limit: PAGE_SIZE,
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      missing_only: missing === '1' || undefined,
    }, s),
    [page, search, clientId, missing, tick],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const hasFilters = !!(search || clientId || missing)
  const colCount = 6

  return (
    <ListPage
      title="Стоимость упаковки"
      subtitle={`Тариф за единицу (годный/брак), по клиенту · всего ${total}`}
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="SKU или название товара…"
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
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={setClientId}
            placeholder="Поиск клиента…"
          />
          <button
            className={`btn sm${missing === '1' ? ' primary' : ' ghost'}`}
            onClick={() => setMissing(missing === '1' ? '' : '1')}
            title="Только товары без заведённого тарифа"
          >
            <Icon name="alert" size={13} />Без тарифа
          </button>
          {hasFilters && (
            <button className="btn ghost sm" onClick={() => setMany({ search: '', client: '', missing: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      }
    >
      <Table>
        <thead>
          <tr>
            <th style={{ width: 160 }}>SKU</th>
            <th>Товар</th>
            <th>Клиент</th>
            <th style={{ width: 140, textAlign: 'right' }}>Годный</th>
            <th style={{ width: 140, textAlign: 'right' }}>Брак</th>
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
              <EmptyState title="Товаров нет" sub={hasFilters ? 'По фильтрам ничего не найдено' : 'Здесь появятся товары'} />
            </td></tr>
          ) : (
            items.map((it) => (
              <tr key={it.id} onClick={() => setEditId(it.id)} style={{ cursor: 'pointer' }}>
                <Td className="mono">{it.sku ?? <span className="t-sub">без SKU</span>}</Td>
                <Td>{it.name}</Td>
                <Td className="t-sub">{it.client_name ?? '—'}</Td>
                <Td className="num" style={{ fontWeight: 600, color: it.good_price_kop != null ? 'var(--c-success)' : 'var(--c-text-faint)' }}>
                  {it.good_price_kop != null ? formatMoneyKopecks(it.good_price_kop) : '—'}
                </Td>
                <Td className="num" style={{ fontWeight: 600, color: it.defect_price_kop != null ? 'var(--c-danger)' : 'var(--c-text-faint)' }}>
                  {it.defect_price_kop != null ? formatMoneyKopecks(it.defect_price_kop) : '—'}
                </Td>
                <Td>
                  {!it.has_price
                    ? <Badge tone="warning" dot>нет тарифа</Badge>
                    : <Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} />}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

      {editId && (
        <PackingPriceDrawer
          productId={editId}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); setTick((t) => t + 1) }}
        />
      )}
    </ListPage>
  )
}
