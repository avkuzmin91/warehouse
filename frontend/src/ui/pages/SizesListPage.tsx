import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSizes } from '../../api/adminApi'
import type { SizeItem } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { Badge } from '../primitives/Badge'
import { Pagination } from '../data/Pagination'
import { SkeletonRows } from '../primitives/Skeleton'
import { Icon } from '../primitives/Icon'

const LIMIT = 20

export function SizesListPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<SizeItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getSizes({ page, limit: LIMIT, name: search || undefined, sort: 'name_asc' })
      .then((r) => { setItems(r.items); setTotal(r.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [page, search])

  return (
    <ListPage
      title="Размеры"
      subtitle={loading ? '' : `${total} записей`}
      actions={
        <button className="btn primary sm" onClick={() => navigate('/dictionaries/sizes/new')}>
          <Icon name="plus" size={14} />Добавить
        </button>
      }
      filters={
        <input
          className="input"
          style={{ width: 200 }}
          placeholder="Поиск…"
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
                  <th className="th">Название</th>
                  <th className="th">Статус</th>
                  <th className="th">Создан</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/dictionaries/sizes/${s.id}`)}>
                    <td className="td" style={{ fontWeight: 500 }}>{s.name}</td>
                    <td className="td">
                      <Badge tone={s.is_active ? 'success' : ''}>{s.is_active ? 'Активен' : 'Неактивен'}</Badge>
                    </td>
                    <td className="td" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                      {s.created_at ? new Date(s.created_at).toLocaleDateString('ru-RU') : '—'}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td className="td" colSpan={3} style={{ textAlign: 'center', color: 'var(--c-text-subtle)' }}>Нет данных</td></tr>
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
