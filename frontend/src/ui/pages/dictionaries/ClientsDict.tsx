import { useState, useEffect } from 'react'
import { getClients } from '../../../api/adminApi'
import type { DictionaryItem } from '../../../api/domainTypes'
import { Icon } from '../../primitives/Icon'
import { Badge } from '../../primitives/Badge'
import { Checkbox } from '../../primitives/Checkbox'
import { Avatar, getInitials } from '../../primitives/Avatar'
import { EmptyState } from '../../primitives/EmptyState'

interface ClientsDictProps {
  onEdit: (item: DictionaryItem) => void
  onTotalLoaded: (total: number) => void
}

export function ClientsDict({ onEdit, onTotalLoaded }: ClientsDictProps) {
  const [items, setItems] = useState<DictionaryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getClients({ page: 1, limit: 100 })
      .then((res) => { setItems(res.items); onTotalLoaded(res.total); setLoading(false) })
      .catch(() => setLoading(false))
  }, [onTotalLoaded])

  return (
    <div className="t-wrap">
      <div className="card-head">
        <div className="card-head-title">Клиенты</div>
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
          {loading ? (
            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24 }}>
              <span className="text-sm muted">Загрузка…</span>
            </td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={4} style={{ padding: 32 }}>
              <EmptyState title="Клиенты не найдены" sub="Нажмите «Новый клиент» чтобы добавить первого" />
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
