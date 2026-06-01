import { useState, useEffect, useCallback } from 'react'
import { getZoneRelocations } from '../../../../../api/balancesApi'
import type { ZoneRelocationItem } from '../../../../../api/balancesApi'
import { useLookups } from '../../../../../hooks/useLookups'
import { Table, Td } from '../../../../data/Table'
import { Pagination } from '../../../../data/Pagination'
import { FiltersBar, FilterCombobox } from '../../../../data/FiltersBar'
import { Badge } from '../../../../primitives/Badge'
import type { BadgeTone } from '../../../../primitives/Badge'
import { Icon } from '../../../../primitives/Icon'
import { SkeletonRows } from '../../../../primitives/Skeleton'
import { EmptyState } from '../../../../primitives/EmptyState'

const PAGE_SIZE = 50

const STATUS_LABELS: Record<string, string> = { good: 'Годный', defect: 'Брак' }
const STATUS_TONE: Record<string, BadgeTone> = { good: 'success', defect: 'warning' }

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

export function RelocationsView() {
  const [items, setItems] = useState<ZoneRelocationItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const { clients } = useLookups()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getZoneRelocations({
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        client_id: clientId || undefined,
      })
      setItems(res.items)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }, [page, search, clientId])

  useEffect(() => { load() }, [load])

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <FiltersBar>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 9, color: 'var(--c-text-subtle)', pointerEvents: 'none' }} />
            <input
              className="input sm"
              style={{ paddingLeft: 28, width: 220, paddingRight: search ? 26 : undefined }}
              placeholder="Товар, SKU…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
            {search && (
              <button
                style={{ position: 'absolute', right: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: 'var(--c-text-subtle)' }}
                onClick={() => { setSearch(''); setPage(1) }}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <FilterCombobox
            label="Клиент"
            value={clientId}
            options={[{ value: '', label: 'Все клиенты' }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => { setClientId(v); setPage(1) }}
            placeholder="Поиск клиента…"
          />
          {clientId && (
            <button className="btn ghost sm" onClick={() => { setClientId(''); setPage(1) }}>
              <Icon name="x" size={12} />Сбросить
            </button>
          )}
          <button className="btn ghost sm icon" title="Обновить" onClick={() => load()}>
            <Icon name="refresh" size={14} style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined} />
          </button>
        </FiltersBar>
      </div>

      <Table>
        <thead>
          <tr>
            <th style={{ width: 130 }}>Дата</th>
            <th>Товар</th>
            <th>Клиент</th>
            <th style={{ width: 90 }}>Статус</th>
            <th>Откуда → Куда</th>
            <th style={{ textAlign: 'right', width: 90 }}>Кол-во</th>
            <th>Комментарий</th>
            <th style={{ width: 160 }}>Кто</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={8} cols={8} />
          ) : items.length === 0 ? (
            <tr><td colSpan={8}><EmptyState title="Перемещений нет" sub="Здесь появятся перемещения товара между местами хранения" /></td></tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <Td className="t-sub mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDateTime(item.created_at)}</Td>
                <Td>
                  <div style={{ fontWeight: 500 }}>{item.product_name ?? '—'}</div>
                  <div className="t-sub mono">
                    {[item.product_sku, item.color_name, item.size_name].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>{item.client_name ?? '—'}</Td>
                <Td><Badge tone={STATUS_TONE[item.status] ?? ''}>{STATUS_LABELS[item.status] ?? item.status}</Badge></Td>
                <Td style={{ fontSize: 13 }}>
                  <span>{item.from_zone_name ?? 'Без места'}</span>
                  <Icon name="arrowRight" size={12} style={{ margin: '0 6px', color: 'var(--c-text-subtle)' }} />
                  <span style={{ fontWeight: 500 }}>{item.to_zone_name ?? 'Без места'}</span>
                </Td>
                <Td className="num" style={{ fontWeight: 600 }}>{item.qty.toLocaleString('ru-RU')}</Td>
                <Td style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>{item.comment ?? '—'}</Td>
                <Td className="t-sub" style={{ fontSize: 12 }}>{item.created_by_email ?? '—'}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
    </>
  )
}
