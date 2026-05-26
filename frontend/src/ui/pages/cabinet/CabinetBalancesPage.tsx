import { useState, useEffect } from 'react'
import { getClientPortalBalances } from '../../../api/clientPortalApi'
import type { InventoryBalanceItem } from '../../../api/domainTypes'
import { ListPage } from '../../layouts/ListPage'
import { Pagination } from '../../data/Pagination'
import { SkeletonRows } from '../../primitives/Skeleton'
import { Badge } from '../../primitives/Badge'

const LIMIT = 20

export function CabinetBalancesPage() {
  const [items, setItems] = useState<InventoryBalanceItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getClientPortalBalances({ page, limit: LIMIT, search: search || undefined, only_positive: true })
      .then((r) => { setItems(r.items); setTotal(r.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [page, search])

  return (
    <ListPage
      title="Остатки"
      subtitle={loading ? '' : `${total} позиций`}
      filters={
        <input
          className="input"
          style={{ width: 280 }}
          placeholder="Поиск по названию или SKU…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        />
      }
    >
      {loading ? <SkeletonRows rows={8} /> : (
        <>
          <div className="t-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th className="th">Товар</th>
                  <th className="th">SKU</th>
                  <th className="th">Цвет</th>
                  <th className="th">Размер</th>
                  <th className="th">Кол-во</th>
                  <th className="th">Брак</th>
                </tr>
              </thead>
              <tbody>
                {items.map((b, i) => (
                  <tr key={i}>
                    <td className="td" style={{ fontWeight: 500 }}>{b.product_name}</td>
                    <td className="td" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{b.product_sku}</td>
                    <td className="td" style={{ fontSize: 12 }}>{b.color_name ?? '—'}</td>
                    <td className="td" style={{ fontSize: 12 }}>{b.size_name ?? '—'}</td>
                    <td className="td">
                      <span style={{ fontWeight: 600, color: b.quantity > 0 ? 'var(--c-success)' : 'var(--c-text-subtle)' }}>{b.quantity}</span>
                    </td>
                    <td className="td">
                      {b.defect_qty > 0 ? (
                        <Badge tone="danger">{b.defect_qty}</Badge>
                      ) : <span style={{ color: 'var(--c-text-subtle)' }}>—</span>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td className="td" colSpan={6} style={{ textAlign: 'center', color: 'var(--c-text-subtle)' }}>Нет данных</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} pageSize={LIMIT} onPage={setPage} />
        </>
      )}
    </ListPage>
  )
}
