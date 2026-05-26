import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getClients } from '../../api/adminApi'
import type { DictionaryItem } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { Badge } from '../primitives/Badge'
import { Pagination } from '../data/Pagination'
import { SkeletonRows } from '../primitives/Skeleton'
import { Icon } from '../primitives/Icon'

const LIMIT = 20

export function ClientsListPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<DictionaryItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getClients({ page, limit: LIMIT, search: search || undefined, sort: 'name_asc' })
      .then((r) => { setItems(r.items); setTotal(r.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [page, search])

  return (
    <ListPage
      title="Клиенты"
      subtitle={loading ? '' : `${total} записей`}
      actions={
        <button className="btn primary sm" onClick={() => navigate('/dictionaries/clients/new')}>
          <Icon name="plus" size={14} />Добавить
        </button>
      }
      filters={
        <input
          className="input"
          style={{ width: 260 }}
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
                {items.map((c) => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/dictionaries/clients/${c.id}`)}>
                    <td className="td" style={{ fontWeight: 500 }}>{c.name}</td>
                    <td className="td">
                      <Badge tone={c.is_active ? 'success' : ''}>{c.is_active ? 'Активен' : 'Неактивен'}</Badge>
                    </td>
                    <td className="td" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('ru-RU') : '—'}
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
