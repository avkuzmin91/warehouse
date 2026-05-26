import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getClientPortalProductCatalog } from '../../../api/clientPortalApi'
import type { ProductItem } from '../../../api/domainTypes'
import { ListPage } from '../../layouts/ListPage'
import { Pagination } from '../../data/Pagination'
import { SkeletonRows } from '../../primitives/Skeleton'
import { Icon } from '../../primitives/Icon'

const LIMIT = 20

export function CabinetProductsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getClientPortalProductCatalog({ page, limit: LIMIT, name: search || undefined })
      .then((r) => { setItems(r.items); setTotal(r.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [page, search])

  return (
    <ListPage
      title="Мои товары"
      subtitle={loading ? '' : `${total} товаров`}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 16 }}>
            {items.map((p) => (
              <div
                key={p.id}
                className="card"
                style={{ cursor: 'pointer', transition: 'box-shadow 120ms' }}
                onClick={() => navigate(`/cabinet/products/${p.id}`)}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.10)')}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = '')}
              >
                <div style={{ height: 120, background: 'var(--c-surface-2, var(--c-surface))', borderRadius: '8px 8px 0 0', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {p.image_urls?.[0] ? (
                    <img src={p.image_urls[0]} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Icon name="box" size={32} style={{ color: 'var(--c-text-subtle)' }} />
                  )}
                </div>
                <div className="card-body" style={{ paddingTop: 10, paddingBottom: 12 }}>
                  <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-subtle)' }}>{p.sku_base}</div>
                </div>
              </div>
            ))}
            {items.length === 0 && (
              <div style={{ gridColumn: '1 / -1', color: 'var(--c-text-subtle)', fontSize: 13 }}>Нет товаров</div>
            )}
          </div>
          <Pagination page={page} total={total} pageSize={LIMIT} onPage={setPage} />
        </>
      )}
    </ListPage>
  )
}
