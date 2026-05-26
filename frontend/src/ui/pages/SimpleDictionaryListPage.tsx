import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSimpleDictionaryPage } from '../../api/adminApi'
import type { DictionaryItem } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { Badge } from '../primitives/Badge'
import { Pagination } from '../data/Pagination'
import { SkeletonRows } from '../primitives/Skeleton'
import { Icon } from '../primitives/Icon'

const ENTITY_META: Record<string, { title: string; nameKey: 'name' | 'search' }> = {
  colors: { title: 'Цвета', nameKey: 'name' },
  'product-types': { title: 'Типы товаров', nameKey: 'name' },
  suppliers: { title: 'Поставщики', nameKey: 'name' },
}

interface Props {
  entity: string
}

const LIMIT = 20

export function SimpleDictionaryListPage({ entity }: Props) {
  const navigate = useNavigate()
  const meta = ENTITY_META[entity] ?? { title: entity, nameKey: 'name' as const }
  const [items, setItems] = useState<DictionaryItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchSimpleDictionaryPage(
      `/${entity}`,
      meta.nameKey,
      { page, limit: LIMIT, [meta.nameKey]: search || undefined, sort: 'name_asc' },
    )
      .then((r) => { setItems(r.items); setTotal(r.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [page, search, entity])

  return (
    <ListPage
      title={meta.title}
      subtitle={loading ? '' : `${total} записей`}
      actions={
        <button className="btn primary sm" onClick={() => navigate(`/dictionaries/${entity}/new`)}>
          <Icon name="plus" size={14} />Добавить
        </button>
      }
      filters={
        <input
          className="input"
          style={{ width: 220 }}
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
                {items.map((item) => (
                  <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/dictionaries/${entity}/${item.id}`)}>
                    <td className="td" style={{ fontWeight: 500 }}>{item.name}</td>
                    <td className="td">
                      <Badge tone={item.is_active ? 'success' : ''}>{item.is_active ? 'Активен' : 'Неактивен'}</Badge>
                    </td>
                    <td className="td" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                      {item.created_at ? new Date(item.created_at).toLocaleDateString('ru-RU') : '—'}
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
