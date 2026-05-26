import { useState, useEffect, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getSimpleDictionaryById,
  updateSimpleDictionaryItem,
  getProductTypeById,
  updateProductType,
} from '../../api/adminApi'
import { DetailPage } from '../layouts/DetailPage'
import { Field, Input } from '../primitives/Input'
import { Toggle } from '../primitives/Checkbox'
import { Skeleton } from '../primitives/Skeleton'
import { Icon } from '../primitives/Icon'

const ENTITY_LABELS: Record<string, string> = {
  colors: 'Цвет',
  'product-types': 'Тип товара',
  suppliers: 'Поставщик',
}

interface Props {
  entity: string
}

export function SimpleDictionaryEditPage({ entity }: Props) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const label = ENTITY_LABELS[entity] ?? 'Запись'
  const isProductType = entity === 'product-types'

  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [requiresColor, setRequiresColor] = useState(false)
  const [requiresSize, setRequiresSize] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    const fetch = isProductType
      ? getProductTypeById(id).then((item) => {
          setName(item.name)
          setIsActive(item.is_active)
          setRequiresColor(item.requires_color)
          setRequiresSize(item.requires_size)
        })
      : getSimpleDictionaryById(`/${entity}`, id).then((item) => {
          setName(item.name)
          setIsActive(item.is_active)
        })
    fetch.then(() => setLoading(false)).catch(() => setLoading(false))
  }, [id, entity, isProductType])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!id || !name.trim()) return
    try {
      setSaving(true)
      setError('')
      if (isProductType) {
        await updateProductType(id, { name: name.trim(), is_active: isActive, requires_color: requiresColor, requires_size: requiresSize })
      } else {
        await updateSimpleDictionaryItem(`/${entity}`, id, { name: name.trim(), is_active: isActive })
      }
      navigate(`/dictionaries/${entity}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setSaving(false)
    }
  }

  if (loading) return <div className="page"><Skeleton height={32} width="40%" /></div>

  return (
    <DetailPage title={`Редактировать: ${label}`} backTo={`/dictionaries/${entity}`}>
      <div style={{ maxWidth: 480 }}>
        <form onSubmit={handleSubmit}>
          <div className="card">
            <div className="card-body">
              <Field label="Название" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
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
                  {saving ? 'Сохранение…' : <><Icon name="check" size={14} />Сохранить</>}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </DetailPage>
  )
}
