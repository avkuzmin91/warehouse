import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearToken, deleteUser, getUsers, me, updateUserRole } from '../api'
import type { User, UserListItem } from '../api'

export function UsersPage() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<UserListItem | null>(null)

  useEffect(() => {
    me().then(setCurrentUser).catch(() => undefined)
    getUsers()
      .then(setUsers)
      .catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Не удалось загрузить пользователей',
        )
      })
  }, [])

  function refreshUsers() {
    getUsers()
      .then(setUsers)
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : 'Не удалось обновить пользователей'),
      )
  }

  async function handleToggleRole(user: UserListItem) {
    setActionError('')
    const nextRole = user.role === 'manager' ? 'user' : 'manager'
    try {
      await updateUserRole(user.id, nextRole)
      refreshUsers()
    } catch (requestError) {
      setActionError(
        requestError instanceof Error ? requestError.message : 'Не удалось изменить роль',
      )
    }
  }

  async function handleConfirmDelete() {
    if (!deleteCandidate) {
      return
    }

    setActionError('')
    try {
      await deleteUser(deleteCandidate.id)
      setDeleteCandidate(null)
      refreshUsers()
    } catch (requestError) {
      setActionError(
        requestError instanceof Error ? requestError.message : 'Не удалось удалить пользователя',
      )
    }
  }

  function handleLogout() {
    clearToken()
    navigate('/auth')
  }

  return (
    <main className="page">
      <section className="auth-card users-card">
        <h1 className="auth-card__title">Список пользователей</h1>
        <p className="auth-card__subtitle">Доступно только для admin</p>

        {error ? <p className="error-text">{error}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}

        <div className="table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Created at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{new Date(user.created_at).toLocaleString('ru-RU')}</td>
                  <td className="users-actions">
                    <button
                      className="btn btn--secondary users-action-btn"
                      type="button"
                      onClick={() => handleToggleRole(user)}
                      disabled={currentUser?.id === user.id || user.role === 'admin'}
                    >
                      {user.role === 'manager' ? 'Сделать пользователем' : 'Сделать менеджером'}
                    </button>
                    <button
                      className="btn btn--secondary users-action-btn users-action-btn--danger"
                      type="button"
                      onClick={() => setDeleteCandidate(user)}
                      disabled={currentUser?.id === user.id}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dashboard-actions">
          <button className="btn btn--secondary" type="button" onClick={() => navigate('/dashboard')}>
            Назад в кабинет
          </button>
          <button className="btn btn--secondary" type="button" onClick={handleLogout}>
            Выйти
          </button>
        </div>
      </section>
      {deleteCandidate ? (
        <div className="modal-overlay" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-label="Подтверждение удаления">
            <p className="confirm-modal__text">
              Вы уверены, что хотите удалить пользователя {deleteCandidate.email}?
            </p>
            <div className="confirm-modal__actions">
              <button className="btn btn--primary" type="button" onClick={handleConfirmDelete}>
                Подтвердить
              </button>
              <button className="btn btn--secondary" type="button" onClick={() => setDeleteCandidate(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
