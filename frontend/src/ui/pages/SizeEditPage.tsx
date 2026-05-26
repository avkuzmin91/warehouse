import { useState, useEffect, type FormEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getSize, updateSize } from '../../api/adminApi'
import { DetailPage } from '../layouts/DetailPage'
import { Field, Input } from '../primitives/Input'
import { Toggle } from '../primitives/Checkbox'
import { Skeleton } from '../primitives/Skeleton'
import { Icon } from '../primitives/Icon'

export function SizeEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    getSize(id).then((s) => {
      setName(s.name)
      setIsActive(s.is_active)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [id])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!id || !name.trim()) return
    try {
      setSaving(true)
      setError('')
      await updateSize(id, { name: name.trim(), is_active: isActive })
      navigate('/dictionaries/sizes')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setSaving(false)
    }
  }

  if (loading) return <div className="page"><Skeleton height={32} width="40%" /></div>

  return (
    <DetailPage title="Редактировать размер" backTo="/dictionaries/sizes">
      <div style={{ maxWidth: 480 }}>
        <form onSubmit={handleSubmit}>
          <div className="card">
            <div className="card-head"><div className="card-head-title">Данные размера</div></div>
            <div className="card-body">
              <Field label="Название" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Активен">
                <Toggle checked={isActive} onChange={setIsActive} label="Размер активен" />
              </Field>
              {error && <div style={{ color: 'var(--c-danger)', fontSize: 12.5 }}>{error}</div>}
              <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn ghost" onClick={() => navigate('/dictionaries/sizes')}>Отмена</button>
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
