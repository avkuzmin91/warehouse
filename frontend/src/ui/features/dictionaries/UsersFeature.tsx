import { useEffect, useRef, useState } from 'react'
import { getUsers, updateUserRole, updateUserClient } from '../../../api/adminApi'
import type { DictionaryItem, UserListItem } from '../../../api/domainTypes'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { useLookups } from '../../../hooks/useLookups'
import { useToast } from '../../feedback/Toast'
import { ListPage } from '../../layouts/ListPage'
import { AccessDeniedPage } from '../../pages/AccessDeniedPage'
import { Alert } from '../../primitives/Alert'
import { Avatar, getInitials } from '../../primitives/Avatar'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'
import { canManageUsers } from '../../../utils/access'
import { fmtDate } from '../../../utils/format'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  manager: 'Менеджер',
  user: 'Без доступа',
  client: 'Клиент',
  warehouse_manager: 'Кладовщик',
  shift_supervisor: 'Начальник смены',
  warehouse_head: 'Начальник склада',
}

const ROLE_TONE: Record<string, 'accent' | 'info' | '' | 'warning' | 'success'> = {
  admin: 'accent',
  manager: 'info',
  warehouse_manager: 'info',
  shift_supervisor: 'warning',
  warehouse_head: 'accent',
  client: 'success',
  user: '',
}

const ASSIGNABLE_ROLES = ['user', 'manager', 'warehouse_manager', 'shift_supervisor', 'warehouse_head', 'client'] as const
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

const ROLE_FILTERS = [
  { role: 'all', label: 'Все', icon: 'users' },
  { role: 'admin', label: 'Администраторы', icon: 'shield' },
  { role: 'manager', label: 'Менеджеры', icon: 'star' },
  { role: 'warehouse_head', label: 'Начальники склада', icon: 'shield' },
  { role: 'warehouse_manager', label: 'Кладовщики', icon: 'archive' },
  { role: 'shift_supervisor', label: 'Начальники смены', icon: 'user' },
  { role: 'user', label: 'Без доступа', icon: 'user' },
  { role: 'client', label: 'Клиенты', icon: 'box' },
] as const

interface RoleMenuProps {
  currentRole: string
  onSelect: (role: AssignableRole) => void
}

function RoleMenu({ currentRole, onSelect }: RoleMenuProps) {
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

  const isFixed = currentRole === 'admin'
  if (isFixed) {
    return <Badge tone={ROLE_TONE[currentRole] ?? ''}>{ROLE_LABELS[currentRole] ?? currentRole}</Badge>
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        onClick={() => setOpen((s) => !s)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          padding: '2px 6px',
          borderRadius: 'var(--r-md)',
          border: '1px solid transparent',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-bg-hover)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
      >
        <Badge tone={ROLE_TONE[currentRole] ?? ''}>{ROLE_LABELS[currentRole] ?? currentRole}</Badge>
        <Icon name="chevDown" size={11} style={{ color: 'var(--c-text-subtle)' }} />
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 40,
            marginTop: 4,
            minWidth: 180,
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-3)',
            padding: 4,
          }}
        >
          <div
            style={{
              padding: '4px 8px 6px',
              fontSize: 11,
              color: 'var(--c-text-muted)',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Назначить роль
          </div>
          {ASSIGNABLE_ROLES.map((role) => (
            <div
              key={role}
              onClick={() => { onSelect(role); setOpen(false) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
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

interface ClientMenuProps {
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          padding: '2px 6px',
          borderRadius: 'var(--r-md)',
          fontSize: 12.5,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-bg-hover)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
      >
        {currentClientName
          ? <span style={{ fontWeight: 500 }}>{currentClientName}</span>
          : <span style={{ color: 'var(--c-text-subtle)' }}>Не назначен</span>}
        <Icon name="chevDown" size={11} style={{ color: 'var(--c-text-subtle)' }} />
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 40,
            marginTop: 4,
            minWidth: 220,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--c-bg-elev)',
            border: '1px solid var(--c-border)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--sh-3)',
            padding: 4,
          }}
        >
          <div
            onClick={() => { onSelect(null); setOpen(false) }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 10px',
              borderRadius: 'var(--r-md)',
              cursor: 'pointer',
              fontSize: 13,
              color: 'var(--c-text-subtle)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
          >
            Не назначен
            {!currentClientId && <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />}
          </div>
          {clients.map((client) => (
            <div
              key={client.id}
              onClick={() => { onSelect(client.id); setOpen(false) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                borderRadius: 'var(--r-md)',
                cursor: 'pointer',
                fontSize: 13,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c-bg-hover)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
            >
              {client.name}
              {client.id === currentClientId && <Icon name="check" size={13} style={{ color: 'var(--c-accent)' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function UsersFeature() {
  const { user, loading: userLoading } = useCurrentUser()
  const toast = useToast()
  const { clients } = useLookups()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')

  useEffect(() => {
    if (userLoading) return
    if (!canManageUsers(user)) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function loadUsers() {
      try {
        const loadedUsers = await getUsers()
        if (!cancelled) {
          setUsers(loadedUsers)
          setLoadError(null)
        }
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'Ошибка загрузки пользователей'
          setLoadError(message)
          toast(message, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadUsers()

    return () => {
      cancelled = true
    }
  }, [toast, user, userLoading])

  if (userLoading) {
    return (
      <ListPage title="Пользователи" subtitle="">
        <div className="t-wrap">
          <table className="t">
            <tbody>
              <SkeletonRows rows={6} />
            </tbody>
          </table>
        </div>
      </ListPage>
    )
  }

  if (!canManageUsers(user)) {
    return <AccessDeniedPage />
  }

  const counts = users.reduce<Record<string, number>>((acc, item) => {
    acc.all = (acc.all ?? 0) + 1
    acc[item.role] = (acc[item.role] ?? 0) + 1
    return acc
  }, {})

  const filtered = users.filter((item) => {
    if (roleFilter !== 'all' && item.role !== roleFilter) return false
    if (search && !item.email.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function handleRoleChange(userId: string, role: AssignableRole) {
    try {
      await updateUserRole(userId, role)
      setUsers((prev) => prev.map((item) => (
        item.id === userId
          ? {
              ...item,
              role,
              client_id: role !== 'client' ? null : item.client_id,
              client_name: role !== 'client' ? null : item.client_name,
            }
          : item
      )))
      toast('Роль обновлена', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    }
  }

  async function handleClientChange(userId: string, clientId: string | null) {
    const client = clientId ? clients.find((item) => item.id === clientId) : null
    try {
      await updateUserClient(userId, clientId)
      setUsers((prev) => prev.map((item) => (
        item.id === userId
          ? { ...item, client_id: clientId, client_name: client?.name ?? null }
          : item
      )))
      toast('Клиент обновлён', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    }
  }

  return (
    <ListPage
      title="Пользователи"
      subtitle={loading ? '' : `${users.length} аккаунтов`}
      filters={(
        <input
          className="input"
          style={{ width: 260 }}
          placeholder="Поиск по email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 16 }}>
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
                <span
                  style={{
                    fontSize: 11.5,
                    color: isActive ? 'var(--c-accent-text)' : 'var(--c-text-muted)',
                    fontWeight: 500,
                  }}
                >
                  {label}
                </span>
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  marginTop: 4,
                  fontVariantNumeric: 'tabular-nums',
                  color: isActive ? 'var(--c-accent-text)' : 'var(--c-text)',
                }}
              >
                {counts[role] ?? 0}
              </div>
            </div>
          )
        })}
      </div>

      {loading ? (
        <div className="t-wrap">
          <table className="t">
            <tbody>
              <SkeletonRows rows={6} />
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {loadError && (
            <Alert tone="danger" style={{ marginBottom: 14 }}>
              {loadError}
            </Alert>
          )}
          <div className="t-wrap" style={{ overflow: 'visible' }}>
            <table className="t">
              <thead>
                <tr>
                  <th className="th">Пользователь</th>
                  <th className="th">Роль</th>
                  <th className="th">Клиент</th>
                  <th className="th">Дата регистрации</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="td">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar initials={getInitials(item.email.split('@')[0])} />
                        <div>
                          <div style={{ fontFamily: 'var(--font-code)', fontSize: 12.5 }}>{item.email}</div>
                          <div style={{ fontSize: 11, color: 'var(--c-text-subtle)', marginTop: 1 }}>
                            {item.id.slice(0, 8)}...
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="td">
                      <RoleMenu currentRole={item.role} onSelect={(role) => handleRoleChange(item.id, role)} />
                    </td>
                    <td className="td">
                      <ClientMenu
                        currentClientId={item.client_id}
                        currentClientName={item.client_name}
                        clients={clients}
                        onSelect={(clientId) => handleClientChange(item.id, clientId)}
                        disabled={item.role !== 'client'}
                      />
                    </td>
                    <td className="td" style={{ fontSize: 12, color: 'var(--c-text-subtle)' }}>
                      {fmtDate(item.created_at ?? null)}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      className="td"
                      colSpan={5}
                      style={{ textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13, padding: '24px 0' }}
                    >
                      Нет результатов
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ListPage>
  )
}
