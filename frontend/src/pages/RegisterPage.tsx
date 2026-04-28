import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { register } from '../api'

const PASSWORD_MIN_LENGTH = 8

export function RegisterPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Email обязателен')
      return
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Пароль должен содержать минимум ${PASSWORD_MIN_LENGTH} символов`)
      return
    }

    if (password !== confirmPassword) {
      setError('Пароли не совпадают')
      return
    }

    try {
      setIsLoading(true)
      await register(trimmedEmail, password)
      navigate('/auth')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Ошибка регистрации')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <h1 className="auth-card__title">Создайте аккаунт</h1>
      <p className="auth-card__subtitle">Заполните поля для регистрации</p>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label className="field-label" htmlFor="register-email">
          Email
        </label>
        <input
          id="register-email"
          className="field-input"
          type="email"
          placeholder="Введите e-mail"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />

        <label className="field-label" htmlFor="register-password">
          Пароль
        </label>
        <input
          id="register-password"
          className="field-input"
          type="password"
          placeholder="Минимум 8 символов"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
        />

        <label className="field-label" htmlFor="register-confirm-password">
          Подтвердите пароль
        </label>
        <input
          id="register-confirm-password"
          className="field-input"
          type="password"
          placeholder="Повторите пароль"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
        />

        {error ? <p className="error-text">{error}</p> : null}

        <button className="btn btn--primary" type="submit" disabled={isLoading}>
          {isLoading ? 'Создание...' : 'Создать аккаунт'}
        </button>

        <div className="divider">или</div>

        <Link className="btn btn--secondary btn--link" to="/auth">
          Назад ко входу
        </Link>
      </form>
    </>
  )
}
