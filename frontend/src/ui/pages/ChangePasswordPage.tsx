import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { changePassword } from '../../api/sessionAuth'
import { Field, Input } from '../primitives/Input'
import { FormPage } from '../layouts/FormPage'

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (next.length < 8) { setError('Новый пароль минимум 8 символов'); return }
    if (next !== confirm) { setError('Пароли не совпадают'); return }
    try {
      setLoading(true)
      await changePassword(current, next)
      setSuccess(true)
      setTimeout(() => navigate('/home'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля')
    } finally {
      setLoading(false)
    }
  }

  return (
    <FormPage title="Смена пароля" subtitle="Введите текущий и новый пароль" backTo="/home">
      <div style={{ maxWidth: 480 }}>
        <div className="card">
          <div className="card-body">
            {success ? (
              <div style={{ color: 'var(--c-success)', fontSize: 13.5, padding: '8px 0' }}>
                Пароль успешно изменён. Перенаправляем…
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                <Field label="Текущий пароль" required>
                  <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
                </Field>
                <Field label="Новый пароль" required help="Минимум 8 символов">
                  <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
                </Field>
                <Field label="Подтвердите пароль" required>
                  <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                </Field>
                {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button type="button" className="btn ghost" onClick={() => navigate(-1)}>Отмена</button>
                  <button type="submit" className="btn primary" disabled={loading}>
                    {loading ? 'Сохранение…' : 'Сохранить'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </FormPage>
  )
}
