import { useState } from 'react'
import { getStoragePricedClients, storageRateLabel } from '../../../../api/storagePricingApi'
import { ListPage } from '../../../layouts/ListPage'
import { Table, Td } from '../../../data/Table'
import { Pagination } from '../../../data/Pagination'
import { FiltersBar } from '../../../data/FiltersBar'
import { Badge } from '../../../primitives/Badge'
import { Icon } from '../../../primitives/Icon'
import { SkeletonRows } from '../../../primitives/Skeleton'
import { EmptyState } from '../../../primitives/EmptyState'
import { useApi } from '../../../../hooks/useApi'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../../hooks/useFilterParams'
import { StoragePriceDrawer } from './StoragePriceDrawer'

const PAGE_SIZE = 25

export function StoragePricesFeature() {
  const [search, setSearch] = useFilterParam('search', '')
  const [missing, setMissing] = useFilterParam('missing', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const [tick, setTick] = useState(0)
  const [editId, setEditId] = useState<string | null>(null)

  const { data, loading, error } = useApi(
    (s) => getStoragePricedClients({
      page, limit: PAGE_SIZE,
      search: search.trim() || undefined,
      missing_only: missing === '1' || undefined,
    }, s),
    [page, search, missing, tick],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const hasFilters = !!(search || missing)
  const colCount = 4

  return (
    <ListPage
      title="Стоимость хранения"
      subtitle={`Тариф хранения остатков по клиенту · всего ${total}`}
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Название клиента…"
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
            className={`btn sm${missing === '1' ? ' primary' : ' ghost'}`}
            onClick={() => setMissing(missing === '1' ? '' : '1')}
            title="Только клиенты без заведённого тарифа хранения"
          >
            <Icon name="alert" size={13} />Без тарифа
          </button>
          {hasFilters && (
            <button className="btn ghost sm" onClick={() => setMany({ search: '', missing: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      }
    >
      <Table>
        <thead>
          <tr>
            <th>Клиент</th>
            <th style={{ width: 220, textAlign: 'right' }}>Тариф</th>
            <th style={{ width: 160, textAlign: 'right' }}>Бесплатный период</th>
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
              <EmptyState title="Клиентов нет" sub={hasFilters ? 'По фильтрам ничего не найдено' : 'Здесь появятся клиенты'} />
            </td></tr>
          ) : (
            items.map((it) => (
              <tr key={it.client_id} onClick={() => setEditId(it.client_id)} style={{ cursor: 'pointer' }}>
                <Td>{it.client_name}</Td>
                <Td className="num" style={{ fontWeight: 600, color: it.price_kop != null ? 'var(--c-success)' : 'var(--c-text-faint)' }}>
                  {it.has_price ? storageRateLabel(it) : '—'}
                </Td>
                <Td className="num" style={{ color: 'var(--c-text-subtle)' }}>
                  {it.free_days != null ? `${it.free_days} дн.` : '—'}
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
        <StoragePriceDrawer
          clientId={editId}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); setTick((t) => t + 1) }}
        />
      )}
    </ListPage>
  )
}
