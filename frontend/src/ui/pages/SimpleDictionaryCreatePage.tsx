import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSimpleDictionaryItem, createProductType } from '../../api/adminApi'
import { FormPage } from '../layouts/FormPage'
import { Field, Input } from '../primitives/Input'
import { Toggle } from '../primitives/Checkbox'
import { Icon } from '../primitives/Icon'

const ENTITY_LABELS: Record<string, string> = {
  colors: 'Цвет',
  'product-types': 'Тип товара',
  suppliers: 'Поставщик',
}

interface Props {
  entity: string
}

export function SimpleDictionaryCreatePage({ entity }: Props) {
  const navigate = useNavigate()
  const label = ENTITY_LABELS[entity] ?? 'Запись'
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [requiresColor, setRequiresColor] = useState(false)
  const [requiresSize, setRequiresSize] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isProductType = entity === 'product-types'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Введите название'); return }
    try {
      setSaving(true)
      setError('')
      if (isProductType) {
        await createProductType({ name: name.trim(), is_active: isActive, requires_color: requiresColor, requires_size: requiresSize })
      } else {
        await createSimpleDictionaryItem(`/${entity}`, { name: name.trim(), is_active: isActive })
      }
      navigate(`/dictionaries/${entity}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setSaving(false)
    }
  }

  return (
    <FormPage title={`Новый: ${label}`} backTo={`/dictionaries/${entity}`}>
      <div style={{ maxWidth: 480 }}>
        <form onSubmit={handleSubmit}>
          <div className="card">
            <div className="card-body">
              <Field label="Название" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Название`} autoFocus />
              </Field>
              {isProductType && (
                <>
                  <Field label="Требует цвет">
                    <Toggle checked={requiresColor} onChange={setRequiresColor} label="Вариант цвета обязателен" />
                  </Field>
                  <Field label="Требует размер">
                    <Toggle checked={requiresSize} onChange={setRequiresSize} label="Вариант размера обязателен" />
                  </Field>
                </>
              )}
              <Field label="Активен">
                <Toggle checked={isActive} onChange={setIsActive} label={`${label} активен`} />
              </Field>
              {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5 }}>{error}</div>}
              <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn ghost" onClick={() => navigate(`/dictionaries/${entity}`)}>Отмена</button>
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
