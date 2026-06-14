import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createDictionaryItem } from '../../../api/adminApi'
import { FormPage } from '../../layouts/FormPage'
import { Field, Input } from '../../primitives/Input'
import { Toggle } from '../../primitives/Checkbox'
import { Icon } from '../../primitives/Icon'

export function ClientCreateFeature() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название'); return }
    try {
      setSaving(true)
      setError('')
      await createDictionaryItem('clients', { name: name.trim(), is_active: isActive })
      navigate('/dictionaries/clients')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setSaving(false)
    }
  }

  return (
    <FormPage title="Новый клиент" backTo="/dictionaries/clients">
      <div style={{ maxWidth: 480 }}>
        <form onSubmit={handleSubmit}>
          <div className="card">
            <div className="card-head"><div className="card-head-title">Данные клиента</div></div>
            <div className="card-body">
              <Field label="Название" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название клиента" autoFocus />
              </Field>
              <Field label="Активен">
                <Toggle checked={isActive} onChange={setIsActive} label="Клиент активен" />
              </Field>
              {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5 }}>{error}</div>}
              <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn ghost" onClick={() => navigate('/dictionaries/clients')}>Отмена</button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? 'Сохранение…' : <><Icon name="check" size={14} />Создать</>}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </FormPage>
  )
}
