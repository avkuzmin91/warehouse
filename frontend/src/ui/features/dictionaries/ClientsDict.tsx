import { useState, useEffect } from 'react'
import { getClients } from '../../../api/adminApi'
import type { DictionaryItem } from '../../../api/domainTypes'
import { Icon } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { Checkbox } from '../../primitives/Checkbox'
import { Avatar, getInitials } from '../../primitives/Avatar'
import { EmptyState } from '../../primitives/EmptyState'

interface ClientsDictProps {
  refreshKey: number
  onEdit: (item: DictionaryItem) => void
  onTotalLoaded: (total: number) => void
}

export function ClientsDict({ refreshKey, onEdit, onTotalLoaded }: ClientsDictProps) {
  const [items, setItems] = useState<DictionaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      getClients({ page: 1, limit: 100, search: search.trim() || undefined })
        .then((res) => {
          setItems(res.items)
          onTotalLoaded(res.total)
          setLoadedOnce(true)
          setLoading(false)
        })
        .catch(() => {
          setItems([])
          setLoading(false)
        })
    }, search ? 250 : 0)
    return () => clearTimeout(timer)
  }, [onTotalLoaded, refreshKey, search])

  return (
    <div className="t-wrap">
      <div className="card-head">
        <div className="card-head-title">Клиенты</div>
        <div className="right row gap-8">
          {loading && loadedOnce && <span className="text-xs subtle">Обновление...</span>}
          <div className="topbar-search" style={{ minWidth: 220, height: 26 }}>
            <Icon name="search" size={12} />
            <input
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, flex: 1 }}
              placeholder="Поиск по клиенту..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>
      <table className="t">
        <thead>
          <tr>
            <th style={{ width: 30 }}>
              {/* TODO: реализовать массовые действия */}
              <Checkbox checked={false} onChange={() => {}} />
            </th>
            <th>Клиент</th>
            <th>Email</th>
            <th style={{ width: 100 }}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {loading && !loadedOnce ? (
            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24 }}>
              <span className="text-sm muted">Загрузка...</span>
            </td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={4} style={{ padding: 32 }}>
              <EmptyState
                title="Клиенты не найдены"
                sub={search ? 'Попробуйте изменить текст поиска' : 'Нажмите «Новый клиент» чтобы добавить первого'}
              />
            </td></tr>
          ) : (
            items.map((c) => (
              <tr key={c.id} onClick={() => onEdit(c)} style={{ cursor: 'pointer' }}>
                <td onClick={(e) => e.stopPropagation()}>
                  {/* TODO: реализовать массовые действия */}
                  <Checkbox checked={false} onChange={() => {}} />
                </td>
                <td>
                  <div className="row gap-8">
                    <Avatar initials={getInitials(c.name)} />
                    <div>
                      <div style={{ fontWeight: 450 }}>{c.name}</div>
                      <div className="text-xs subtle mono">{c.id}</div>
                    </div>
                  </div>
                </td>
                <td className="text-sm">
                  <div className="row gap-8">
                    <Icon name="mail" size={13} style={{ color: 'var(--c-text-faint)', flexShrink: 0 }} />
                    <span className="faint">—</span>
                  </div>
                </td>
                <td>
                  <Badge tone={c.is_active ? 'success' : ''} dot>
                    {c.is_active ? 'Активен' : 'Архив'}
                  </Badge>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
