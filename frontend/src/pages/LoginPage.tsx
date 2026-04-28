import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { login, saveToken } from '../api'

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!email || !password) {
      setError('Заполните email и пароль')
      return
    }

    try {
      setIsLoading(true)
      const response = await login(email, password)
      saveToken(response.token)
      navigate('/dashboard')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Ошибка входа')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <h1 className="auth-card__title">Добро пожаловать!</h1>
      <p className="auth-card__subtitle">Войдите в свой аккаунт</p>

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="field-input"
          type="email"
          placeholder="Введите свой e-mail"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />

        <label className="field-label" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          className="field-input"
          type="password"
          placeholder="Введите пароль"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />

        {error ? <p className="error-text">{error}</p> : null}

        <button className="btn btn--primary" type="submit" disabled={isLoading}>
          {isLoading ? 'Вход...' : 'Войти'}
        </button>

        <div className="divider">или</div>

        <Link className="btn btn--secondary btn--link" to="/auth/register">
          Зарегистрироваться
        </Link>
      </form>
    </>
  )
}
