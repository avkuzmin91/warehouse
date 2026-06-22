import { useNavigate } from 'react-router-dom'
import { getUninvoicedShipments } from '../../../api/invoicesApi'
import type { UninvoicedShipment } from '../../../api/invoicesApi'
import { ListPage } from '../../layouts/ListPage'
import { Pagination } from '../../data/Pagination'
import { FiltersBar, FilterCombobox } from '../../data/FiltersBar'
import { DateRange } from '../../data/DateRange'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { EmptyState } from '../../primitives/EmptyState'
import { fmtDate } from '../../../utils/format'
import { useLookups } from '../../../hooks/useLookups'
import { useApi } from '../../../hooks/useApi'
import { useFilterParam, useFilterParamsActions, usePageParam } from '../../../hooks/useFilterParams'
import { CargoTag } from './financeUI'

const PAGE_SIZE = 25

type Group = { key: string; clientId: string | null; name: string; rows: UninvoicedShipment[]; qty: number }

function groupByClient(items: UninvoicedShipment[]): Group[] {
  const map = new Map<string, Group>()
  for (const s of items) {
    const key = s.client_id ?? s.client_name ?? '—'
    let g = map.get(key)
    if (!g) {
      g = { key, clientId: s.client_id, name: s.client_name ?? 'Без клиента', rows: [], qty: 0 }
      map.set(key, g)
    }
    g.rows.push(s)
    g.qty += s.total_qty
  }
  return [...map.values()]
}

export function UninvoicedShipmentsFeature() {
  const navigate = useNavigate()

  const [search, setSearch] = useFilterParam('search', '')
  const [clientId, setClientId] = useFilterParam('client', '')
  const [dateFrom, setDateFrom] = useFilterParam('from', '')
  const [dateTo, setDateTo] = useFilterParam('to', '')
  const [page, setPage] = usePageParam()
  const { setMany } = useFilterParamsActions()
  const { clients } = useLookups()

  const { data, loading, error } = useApi(
    (signal) => getUninvoicedShipments({
      page, limit: PAGE_SIZE,
      search: search.trim() || undefined,
      client_id: clientId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }, signal),
    [page, search, clientId, dateFrom, dateTo],
  )

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const groups = groupByClient(items)

  function createForClient(cid: string | null) {
    navigate(`/finance/invoices/new${cid ? `?client=${cid}` : ''}`)
  }

  return (
    <ListPage
      title="Отгрузки без счёта"
      subtitle={`Завершённых отгрузок без счёта: ${total}`}
      actions={
        <button className="btn primary" onClick={() => createForClient(clientId || null)}>
          <Icon name="plus" size={14} />Создать счёт
        </button>
      }
      filters={
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Номер, клиент, адрес…"
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
            onChange={(v) => setClientId(v)}
            placeholder="Поиск клиента…"
          />
          <DateRange
            from={dateFrom} to={dateTo}
            onFromChange={(v) => setDateFrom(v)}
            onToChange={(v) => setDateTo(v)}
            onClear={() => setMany({ from: '', to: '' })}
          />
          {(clientId || search || dateFrom || dateTo) && (
            <button className="btn ghost sm" onClick={() => setMany({ client: '', search: '', from: '', to: '' })}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
        </FiltersBar>
      }
    >
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 14,
        borderRadius: 'var(--r-lg)', border: '1px solid var(--c-border)', background: 'var(--c-accent-bg)',
        borderLeft: '3px solid var(--c-accent)',
      }}>
        <Icon name="inbox" size={15} style={{ color: 'var(--c-accent)' }} />
        <span style={{ fontSize: 13, color: 'var(--c-accent-text)' }}>
          Отгрузки сгруппированы по клиенту. Выберите клиента и соберите счёт — после привязки отгрузка исчезнет из реестра.
        </span>
      </div>

      {loading ? (
        <div className="t-wrap">
          <table className="t" style={{ width: '100%' }}><tbody><SkeletonRows rows={6} cols={6} /></tbody></table>
        </div>
      ) : error ? (
        <EmptyState title="Не удалось загрузить" sub={error.message} />
      ) : groups.length === 0 ? (
        <EmptyState title="Нет отгрузок без счёта" sub="Все завершённые отгрузки включены в счета" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {groups.map((g) => (
            <div key={g.key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                borderBottom: '1px solid var(--c-border)', background: 'var(--c-bg-sunken)',
              }}>
                <Icon name="building" size={15} style={{ color: 'var(--c-text-muted)' }} />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{g.name}</span>
                <span style={{
                  fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--c-text-subtle)',
                  background: 'var(--c-bg-elev)', border: '1px solid var(--c-border)', padding: '1px 7px', borderRadius: 99,
                }}>
                  {g.rows.length} отгр · {g.qty.toLocaleString('ru-RU')} шт
                </span>
                <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => createForClient(g.clientId)}>
                  <Icon name="plus" size={12} />Счёт для клиента
                </button>
              </div>
              <table className="t" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Номер</th>
                    <th style={{ width: 110 }}>Тип</th>
                    <th>Адрес</th>
                    <th style={{ width: 130 }}>Дата отгрузки</th>
                    <th style={{ width: 70, textAlign: 'right' }}>SKU</th>
                    <th style={{ width: 100, textAlign: 'right' }}>Кол-во</th>
                    <th style={{ width: 28 }} />
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/inventory/dispatches/${r.id}`)}>
                      <td><span className="mono" style={{ fontWeight: 500 }}>{r.doc_number}</span></td>
                      <td><CargoTag cargoType={r.cargo_type} /></td>
                      <td><span style={{ color: 'var(--c-text-subtle)' }}>{r.destination ?? '—'}</span></td>
                      <td><span style={{ color: 'var(--c-text-subtle)' }}>{fmtDate(r.ship_date)}</span></td>
                      <td className="num">{r.sku_count}</td>
                      <td className="num">{r.total_qty.toLocaleString('ru-RU')}</td>
                      <td><Icon name="chev" size={14} style={{ color: 'var(--c-text-faint)' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </ListPage>
  )
}
