import { useState, useEffect } from 'react'
import { getUsers, updateUserRole, getClients } from '../../api/adminApi'
import type { UserListItem } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { Badge } from '../primitives/Badge'
import { SkeletonRows } from '../primitives/Skeleton'
import { useToast } from '../feedback/Toast'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  user: 'Пользователь',
  client: 'Клиент',
  warehouse_manager: 'Кладовщик',
}

const ROLE_TONE: Record<string, 'accent' | 'info' | '' | 'warning' | 'success'> = {
  admin: 'accent',
  manager: 'info',
  warehouse_manager: 'info',
  client: 'success',
  user: '',
}

const ASSIGNABLE_ROLES = ['user', 'manager', 'client'] as const

export function UsersPage() {
  const toast = useToast()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([
      getUsers(),
      getClients({ limit: 100, sort: 'name_asc' }).then((r) => r.items),
    ]).then(([u]) => {
      setUsers(u)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = users.filter((u) =>
    !search || u.email.toLowerCase().includes(search.toLowerCase())
  )

  async function handleRoleChange(userId: string, role: 'user' | 'manager' | 'client') {
    try {
      await updateUserRole(userId, role)
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u))
      toast('Роль обновлена', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    }
  }

  return (
    <ListPage
      title="Пользователи"
      subtitle={loading ? '' : `${users.length} аккаунтов`}
      filters={
        <input
          className="input"
          style={{ width: 260 }}
          placeholder="Поиск по email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      }
    >
      {loading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th className="th">Email</th>
                <th className="th">Роль</th>
                <th className="th">Клиент</th>
                <th className="th">Дата регистрации</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="td" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{u.email}</td>
                  <td className="td">
                    {u.role === 'admin' || u.role === 'warehouse_manager' ? (
                      <Badge tone={ROLE_TONE[u.role] ?? ''}>{ROLE_LABELS[u.role] ?? u.role}</Badge>
                    ) : (
                      <select
                        className="input"
                        style={{ padding: '2px 6px', height: 28, fontSize: 12 }}
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as 'user' | 'manager' | 'client')}
                      >
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="td" style={{ fontSize: 12.5 }}>
                    {u.client_name ?? <span style={{ color: 'var(--c-text-subtle)' }}>—</span>}
                  </td>
                  <td className="td" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="td" colSpan={4} style={{ textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
                    Нет результатов
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </ListPage>
  )
}
