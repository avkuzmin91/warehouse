import { useState, useEffect } from 'react'
import { createDictionaryItem, updateDictionaryItem } from '../../../api/adminApi'
import type { DictionaryItem } from '../../../api/domainTypes'
import { Drawer } from '../../feedback/Drawer'
import { Field, Input } from '../../primitives/Input'
import { Toggle } from '../../primitives/Checkbox'
import { Icon } from '../../primitives/Icon'

interface ClientSheetProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  isNew: boolean
  initial?: DictionaryItem | null
}

export function ClientSheet({ open, onClose, onSaved, isNew, initial }: ClientSheetProps) {
  const [name, setName] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setActive(initial?.is_active ?? true)
    setError(null)
  }, [open, initial])

  const handleSave = async () => {
    if (!name.trim()) { setError('Введите название клиента'); return }
    setSaving(true)
    setError(null)
    try {
      const payload = { name: name.trim(), is_active: active }
      if (isNew) {
        await createDictionaryItem('clients', payload)
      } else if (initial) {
        await updateDictionaryItem('clients', initial.id, payload)
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? 'Новый клиент' : (initial?.name ?? '')}
      subtitle={isNew ? 'Добавление клиента в систему' : 'Редактирование'}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icon name="check" size={13} />
            {saving ? 'Сохранение…' : isNew ? 'Создать' : 'Сохранить'}
          </button>
        </>
      }
    >
      <Field label="Название" required error={error ?? undefined}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ООО «Mango Republic»"
          autoFocus
        />
      </Field>

      <Field label="Статус" help="Архивные клиенты скрыты, но не удалены">
        <div style={{ padding: '10px 12px', background: 'var(--c-bg-sunken)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Toggle checked={active} onChange={setActive} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{active ? 'Активен' : 'Архив'}</div>
            <div className="text-xs subtle">{active ? 'Доступен для выбора в формах' : 'Не появляется в списках выбора'}</div>
          </div>
        </div>
      </Field>

      {!isNew && initial && (
        <div style={{ padding: '12px 14px', background: 'var(--c-bg-sunken)', borderRadius: 6 }}>
          <div className="text-xs subtle" style={{ marginBottom: 6 }}>МЕТА</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, fontSize: 12.5 }}>
            <span className="muted">Создано</span>
            <span>{initial.created_at ? new Date(initial.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span>
            <span className="muted">Изменено</span>
            <span>{initial.updated_at ? new Date(initial.updated_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span>
          </div>
        </div>
      )}
    </Drawer>
  )
}
