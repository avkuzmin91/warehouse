import { useCallback, useEffect, useMemo, useState } from 'react'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { CollectionActions } from '../components/CollectionActions'
import { FiltersPanel, type FilterFieldConfig } from '../components/FiltersPanel'
import { ListPageLayout } from '../components/ListPageLayout'
import { ListPagination } from '../components/ListPagination'
import { ConfirmDialog } from '../components/ModalDialog'
import { Table, type TableColumn } from '../components/Table'
import { UsersRoleGrantMenu } from '../components/UsersRoleGrantMenu'
import { useQueryState } from '../hooks/useQueryState'
import type { ListSortState } from '../utils/queryState'
import {
  deleteUser,
  getUsers,
  me,
  updateUserRole,
  type AssignableUserRole,
  type User,
  type UserListItem,
} from '../api'

const USERS_FILTER_KEYS = ['search', 'users_role', 'date_from', 'date_to'] as const

const USERS_ROLE_FILTER_OPTIONS = [
  { value: '', label: 'Роль' },
  { value: 'user', label: 'Пользователь' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'client', label: 'Клиент' },
  { value: 'admin', label: 'Администратор' },
]

const USERS_FILTER_FIELDS: FilterFieldConfig[] = [
  { name: 'search', type: 'text', placeholder: 'Поиск по email' },
  {
    name: 'users_role',
    type: 'dictionary_autocomplete',
    options: USERS_ROLE_FILTER_OPTIONS,
  },
  { type: 'date_range', placeholder: 'Дата регистрации' },
]

function userRoleLabel(role: UserListItem['role']): string {
  switch (role) {
    case 'admin':
      return 'Администратор'
    case 'manager':
      return 'Менеджер'
    case 'client':
      return 'Клиент'
    case 'user':
      return 'Пользователь'
    default:
      return role
  }
}

/** Календарная дата регистрации в локальной TZ (для сопоставления с date_from/date_to из фильтра). */
function userRegistrationYyyyMmDd(createdAtIso: string): string | null {
  const d = new Date(createdAtIso)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function filterUsers(
  rows: UserListItem[],
  search: string | undefined,
  usersRole: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): UserListItem[] {
  let out = rows
  if (search != null && search.trim() !== '') {
    const q = search.trim().toLowerCase()
    out = out.filter((u) => u.email.toLowerCase().includes(q))
  }
  if (usersRole != null && usersRole !== '') {
    out = out.filter((u) => u.role === usersRole)
  }
  if (dateFrom != null && dateFrom !== '') {
    out = out.filter((u) => {
      const key = userRegistrationYyyyMmDd(u.created_at)
      return key != null && key >= dateFrom
    })
  }
  if (dateTo != null && dateTo !== '') {
    out = out.filter((u) => {
      const key = userRegistrationYyyyMmDd(u.created_at)
      return key != null && key <= dateTo
    })
  }
  return out
}

function sortUsers(rows: UserListItem[], sort: ListSortState): UserListItem[] {
  if (!sort) return rows
  const dir = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.field === 'email') return a.email.localeCompare(b.email, 'ru') * dir
    if (sort.field === 'role') return a.role.localeCompare(b.role, 'ru') * dir
    if (sort.field === 'created_at') {
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir
    }
    return 0
  })
}

function UserDeleteIconButton({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="users-icon-btn users-icon-btn--delete"
      aria-label="Удалить пользователя"
      title="Удалить"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <svg className="users-icon-btn__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M9 3h6M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14"
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

export function UsersPage() {
  const { query, setFilters, setPage, setLimit, cycleSortField, resetFilters } = useQueryState({
    filterKeys: USERS_FILTER_KEYS,
  })

  const [users, setUsers] = useState<UserListItem[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<UserListItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const loadUsers = useCallback(() => {
    setLoading(true)
    setError('')
    return getUsers()
      .then(setUsers)
      .catch((requestError) => {
        setError(
          requestError instanceof Error ? requestError.message : 'Не удалось загрузить пользователей',
        )
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    me().then(setCurrentUser).catch(() => undefined)
  }, [])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers, reloadKey])

  const refreshUsers = useCallback(() => {
    return getUsers()
      .then(setUsers)
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : 'Не удалось обновить пользователей'),
      )
  }, [])

  const filteredSorted = useMemo(() => {
    const f = filterUsers(
      users,
      query.filters.search,
      query.filters.users_role,
      query.filters.date_from,
      query.filters.date_to,
    )
    return sortUsers(f, query.sort)
  }, [
    users,
    query.filters.search,
    query.filters.users_role,
    query.filters.date_from,
    query.filters.date_to,
    query.sort,
  ])

  const total = filteredSorted.length
  const pageData = useMemo(() => {
    const start = (query.page - 1) * query.limit
    return filteredSorted.slice(start, start + query.limit)
  }, [filteredSorted, query.page, query.limit])

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(total / query.limit) || 1)
    if (total > 0 && query.page > lastPage) {
      setPage(lastPage)
    }
  }, [total, query.limit, query.page, setPage])

  const handleGrantRole = useCallback(
    async (userId: string, role: AssignableUserRole) => {
      const row = users.find((u) => u.id === userId)
      if (row && row.role === role) return
      setActionError('')
      try {
        await updateUserRole(userId, role)
        await refreshUsers()
      } catch (requestError) {
        setActionError(
          requestError instanceof Error ? requestError.message : 'Не удалось изменить роль',
        )
      }
    },
    [refreshUsers, users],
  )

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteCandidate) return

    setActionError('')
    try {
      await deleteUser(deleteCandidate.id)
      setDeleteCandidate(null)
      await refreshUsers()
    } catch (requestError) {
      setActionError(
        requestError instanceof Error ? requestError.message : 'Не удалось удалить пользователя',
      )
    }
  }, [deleteCandidate, refreshUsers])

  const columns: TableColumn<UserListItem>[] = useMemo(
    () => [
      { key: 'email', title: 'Email', sortable: true },
      {
        key: 'role',
        title: 'Роль',
        sortable: true,
        render: (_, row) => userRoleLabel(row.role),
      },
      {
        key: 'created_at',
        title: 'Дата регистрации',
        sortable: true,
        render: (v) => new Date(String(v)).toLocaleString('ru-RU'),
      },
      {
        key: 'id',
        title: 'Действия',
        render: (_, row) => (
          <div className="users-table-actions">
            <UsersRoleGrantMenu
              target={row}
              currentUserId={currentUser?.id}
              onGrant={(id, role) => void handleGrantRole(id, role)}
            />
            <UserDeleteIconButton
              disabled={currentUser?.id === row.id || row.role === 'admin'}
              onClick={() => setDeleteCandidate(row)}
            />
          </div>
        ),
      },
    ],
    [currentUser?.id, handleGrantRole],
  )

  return (
    <ListPageLayout
      wrapWithPageContainer
      pageContainerProps={{
        maxWidth: 1200,
        cardClassName: 'users-card product-dict-card',
        footer: (
          <ConfirmDialog
            open={deleteCandidate != null}
            ariaLabel="Подтверждение удаления"
            cancelLabel="Отмена"
            confirmLabel="Удалить"
            confirmVariant="danger"
            message={
              <>
                Удалить пользователя{' '}
                <span className="confirm-modal__emphasis">{deleteCandidate?.email ?? ''}</span>?
              </>
            }
            onCancel={() => setDeleteCandidate(null)}
            onConfirm={() => void handleConfirmDelete()}
          />
        ),
      }}
      breadcrumbs={<Breadcrumbs />}
      filters={
        <FiltersPanel
          disabled={loading}
          fields={USERS_FILTER_FIELDS}
          values={{
            search: query.filters.search,
            users_role: query.filters.users_role,
            date_from: query.filters.date_from,
            date_to: query.filters.date_to,
          }}
          onTextFilterDebounced={(name, value) => {
            if (name === 'search') setFilters({ search: value || undefined })
          }}
          onSelectChange={(name, value) => {
            if (name === 'users_role') setFilters({ users_role: value ?? undefined })
          }}
          onDateRangeChange={(next) =>
            setFilters({ date_from: next.date_from, date_to: next.date_to })
          }
          actions={
            <CollectionActions onResetFilters={resetFilters} disabled={loading} />
          }
        />
      }
      table={
        <Table<UserListItem>
          columns={columns}
          data={pageData}
          loading={loading}
          sort={query.sort}
          onSortClick={cycleSortField}
          wrapClassName="product-table-wrap"
        />
      }
      afterTable={actionError ? <p className="error-text users-page__action-error">{actionError}</p> : null}
      pagination={
        <ListPagination
          page={query.page}
          limit={query.limit}
          total={total}
          onPageChange={setPage}
          onLimitChange={setLimit}
          disabled={loading}
        />
      }
      error={error || null}
      onRetry={() => {
        setError('')
        setReloadKey((k) => k + 1)
      }}
    />
  )
}
