import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getProducts } from '../../api/adminApi'
import { resolvePublicUploadSrc } from '../../api/constants'
import type { ProductItem } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { Badge } from '../primitives/Badge'
import { Pagination } from '../data/Pagination'
import { SkeletonRows } from '../primitives/Skeleton'
import { Icon } from '../primitives/Icon'

const LIMIT = 20

export function ProductsListPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getProducts({ page, limit: LIMIT, search: search || undefined, sort: 'name_asc' })
      .then((r) => { setItems(r.items); setTotal(r.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [page, search])

  return (
    <ListPage
      title="Товары"
      subtitle={loading ? '' : `${total} записей`}
      actions={
        <button className="btn primary sm" onClick={() => navigate('/dictionaries/products/new')}>
          <Icon name="plus" size={14} />Добавить
        </button>
      }
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
                  <th className="th" style={{ width: 56 }}></th>
                  <th className="th">Название</th>
                  <th className="th">SKU</th>
                  <th className="th">Тип</th>
                  <th className="th">Клиент</th>
                  <th className="th">Статус</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/dictionaries/products/${p.id}`)}>
                    <td className="td">
                      {p.image_urls?.[0] ? (
                        <img src={resolvePublicUploadSrc(p.image_urls[0])} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--c-border)', display: 'block' }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 6, background: 'var(--c-surface-2, var(--c-surface))', border: '1px solid var(--c-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="box" size={16} style={{ color: 'var(--c-text-subtle)' }} />
                        </div>
                      )}
                    </td>
                    <td className="td" style={{ fontWeight: 500 }}>{p.name}</td>
                    <td className="td" style={{ fontFamily: 'var(--font-code)', fontSize: 12 }}>{p.sku_base}</td>
                    <td className="td" style={{ fontSize: 12.5 }}>{p.type_name ?? '—'}</td>
                    <td className="td" style={{ fontSize: 12.5 }}>{p.client_name ?? '—'}</td>
                    <td className="td">
                      <Badge tone={p.is_active ? 'success' : ''}>{p.is_active ? 'Активен' : 'Неактивен'}</Badge>
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
