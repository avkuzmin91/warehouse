import { useState, useEffect, useRef } from 'react'
import { getUsers, updateUserRole, updateUserClient, deleteUser, getClients } from '../../api/adminApi'
import type { UserListItem, DictionaryItem } from '../../api/domainTypes'
import { ListPage } from '../layouts/ListPage'
import { Badge } from '../primitives/Badge'
import { SkeletonRows } from '../primitives/Skeleton'
import { Icon } from '../primitives/Icon'
import { Avatar, getInitials } from '../primitives/Avatar'
import { useToast } from '../feedback/Toast'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  user: 'Оператор',
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
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

const ROLE_FILTERS = [
  { role: 'all', label: 'Все', icon: 'users' },
  { role: 'admin', label: 'Администраторы', icon: 'shield' },
  { role: 'manager', label: 'Менеджеры', icon: 'star' },
  { role: 'warehouse_manager', label: 'Кладовщики', icon: 'archive' },
  { role: 'user', label: 'Операторы', icon: 'user' },
  { role: 'client', label: 'Клиенты', icon: 'box' },
] as const

// --- Role dropdown ---
interface RoleMenuProps {
  userId: string
  currentRole: string
  onSelect: (role: AssignableRole) => void
}

function RoleMenu({ userId, currentRole, onSelect }: RoleMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isFixed = currentRole === 'admin' || currentRole === 'warehouse_manager'
  if (isFixed) {
    return <Badge tone={ROLE_TONE[currentRole] ?? ''}>{ROLE_LABELS[currentRole] ?? currentRole}</Badge>
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        onClick={() => setOpen((s) => !s)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--r-md)',
          border: '1px solid transparent',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
      >
        <Badge tone={ROLE_TONE[currentRole] ?? ''}>{ROLE_LABELS[currentRole] ?? currentRole}</Badge>
        <Icon name="chevDown" size={11} style={{ color: 'var(--c-text-subtle)' }} />
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4,
          minWidth: 180,
          background: 'var(--c-bg-elev)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-3)',
          padding: 4,
        }}>
          <div style={{ padding: '4px 8px 6px', fontSize: 11, color: 'var(--c-text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Назначить роль
          </div>
          {ASSIGNABLE_ROLES.map((role) => (
            <div
              key={role}
              onClick={() => { onSelect(role); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 13,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              <Badge tone={ROLE_TONE[role] ?? ''}>{ROLE_LABELS[role]}</Badge>
              {role === currentRole && <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Client assignment dropdown ---
interface ClientMenuProps {
  userId: string
  currentClientId: string | null | undefined
  currentClientName: string | null | undefined
  clients: DictionaryItem[]
  onSelect: (clientId: string | null) => void
  disabled?: boolean
}

function ClientMenu({ currentClientId, currentClientName, clients, onSelect, disabled }: ClientMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (disabled) {
    return <span style={{ color: 'var(--c-text-subtle)', fontSize: 12.5 }}>—</span>
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        onClick={() => setOpen((s) => !s)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--r-md)', fontSize: 12.5,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
      >
        {currentClientName
          ? <span style={{ fontWeight: 500 }}>{currentClientName}</span>
          : <span style={{ color: 'var(--c-text-subtle)' }}>Не назначен</span>
        }
        <Icon name="chevDown" size={11} style={{ color: 'var(--c-text-subtle)' }} />
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 4,
          minWidth: 220, maxHeight: 260, overflowY: 'auto',
          background: 'var(--c-bg-elev)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--sh-3)',
          padding: 4,
        }}>
          <div
            onClick={() => { onSelect(null); setOpen(false) }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 13,
              color: 'var(--c-text-subtle)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
          >
            Не назначен
            {!currentClientId && <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />}
          </div>
          {clients.map((c) => (
            <div
              key={c.id}
              onClick={() => { onSelect(c.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 10px', borderRadius: 'var(--r-md)', cursor: 'pointer', fontSize: 13,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--c-bg-hover)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '' }}
            >
              {c.name}
              {c.id === currentClientId && <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main page ---
export function UsersPage() {
  const toast = useToast()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [clients, setClients] = useState<DictionaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')

  useEffect(() => {
    Promise.all([
      getUsers(),
      getClients({ limit: 200, sort: 'name_asc' }).then((r) => r.items),
    ]).then(([u, c]) => {
      setUsers(u)
      setClients(c)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const counts = users.reduce<Record<string, number>>((acc, u) => {
    acc['all'] = (acc['all'] ?? 0) + 1
    acc[u.role] = (acc[u.role] ?? 0) + 1
    return acc
  }, {})

  const filtered = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false
    if (search && !u.email.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function handleRoleChange(userId: string, role: AssignableRole) {
    try {
      await updateUserRole(userId, role)
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role, client_id: role !== 'client' ? null : u.client_id, client_name: role !== 'client' ? null : u.client_name } : u))
      toast('Роль обновлена', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    }
  }

  async function handleClientChange(userId: string, clientId: string | null) {
    const client = clientId ? clients.find((c) => c.id === clientId) : null
    try {
      await updateUserClient(userId, clientId)
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, client_id: clientId, client_name: client?.name ?? null } : u))
      toast('Клиент обновлён', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    }
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Удалить пользователя ${email}?`)) return
    try {
      await deleteUser(userId)
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      toast('Пользователь удалён', 'success')
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
      {/* Role filter tabs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 16 }}>
        {ROLE_FILTERS.map(({ role, label, icon }) => {
          const isActive = roleFilter === role
          return (
            <div
              key={role}
              onClick={() => setRoleFilter(role)}
              style={{
                padding: '10px 12px',
                background: isActive ? 'var(--c-accent-bg)' : 'var(--c-bg-elev)',
                border: `1px solid ${isActive ? 'var(--c-accent-border)' : 'var(--c-border)'}`,
                borderRadius: 'var(--r-lg)',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon
                  name={icon as Parameters<typeof Icon>[0]['name']}
                  size={13}
                  style={{ color: isActive ? 'var(--c-accent)' : 'var(--c-text-subtle)' }}
                />
                <span style={{ fontSize: 11.5, color: isActive ? 'var(--c-accent-text)' : 'var(--c-text-muted)', fontWeight: 500 }}>
                  {label}
                </span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4, fontVariantNumeric: 'tabular-nums', color: isActive ? 'var(--c-accent-text)' : 'var(--c-text)' }}>
                {counts[role] ?? 0}
              </div>
            </div>
          )
        })}
      </div>

      {loading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th className="th">Пользователь</th>
                <th className="th">Роль</th>
                <th className="th">Клиент</th>
                <th className="th">Дата регистрации</th>
                <th className="th" style={{ width: 48 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td className="td">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar initials={getInitials(u.email.split('@')[0])} />
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{u.email}</div>
                        <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 1 }}>{u.id.slice(0, 8)}…</div>
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    <RoleMenu
                      userId={u.id}
                      currentRole={u.role}
                      onSelect={(role) => handleRoleChange(u.id, role)}
                    />
                  </td>
                  <td className="td">
                    <ClientMenu
                      userId={u.id}
                      currentClientId={u.client_id}
                      currentClientName={u.client_name}
                      clients={clients}
                      onSelect={(clientId) => handleClientChange(u.id, clientId)}
                      disabled={u.role !== 'client'}
                    />
                  </td>
                  <td className="td" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—'}
                  </td>
                  <td className="td" style={{ textAlign: 'right' }}>
                    {u.role !== 'admin' && (
                      <button
                        className="btn ghost icon sm"
                        title="Удалить пользователя"
                        onClick={() => handleDelete(u.id, u.email)}
                        style={{ color: 'var(--c-danger)' }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="td" colSpan={5} style={{ textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13, padding: '24px 0' }}>
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
