import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { PageContainer } from '../components/PageContainer'
import { changePassword, saveToken } from '../api/sessionAuth'

const PASSWORD_MIN_LENGTH = 8
const FORM_ID = 'change-password-form'

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  function handleBack() {
    navigate(-1)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!currentPassword) {
      setError('Введите текущий пароль')
      return
    }
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`Новый пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Новый пароль и подтверждение не совпадают')
      return
    }

    try {
      setIsLoading(true)
      const response = await changePassword(currentPassword, newPassword)
        saveToken(response.access_token)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess('Пароль успешно изменён')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось сменить пароль')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <PageContainer maxWidth={480} cardClassName="change-password-page">
      <Breadcrumbs />
      <form id={FORM_ID} className="auth-form change-password-form" onSubmit={handleSubmit} noValidate>
        <label className="field-label" htmlFor="change-password-current">
          Текущий пароль
        </label>
        <input
          id="change-password-current"
          className="field-input"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
        />

        <label className="field-label" htmlFor="change-password-new">
          Новый пароль
        </label>
        <input
          id="change-password-new"
          className="field-input"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete="new-password"
        />

        <label className="field-label" htmlFor="change-password-confirm">
          Подтверждение нового пароля
        </label>
        <input
          id="change-password-confirm"
          className="field-input"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
        />

        {error ? <p className="error-text change-password-form__message">{error}</p> : null}
        {success ? (
          <p className="change-password-form__message change-password-form__message--success">{success}</p>
        ) : null}
      </form>

      <div className="product-form-actions action-bar change-password-actions">
        <div className="action-bar__trailing change-password-actions__trailing">
          <button
            type="submit"
            form={FORM_ID}
            className="btn btn--primary btn--form-action"
            disabled={isLoading}
          >
            {isLoading ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--form-action"
            onClick={handleBack}
          >
            Назад
          </button>
        </div>
      </div>
    </PageContainer>
  )
}
