import { useRef, useState } from 'react'
import { newRequestId } from '../../api/http'
import { Icon } from '../../components/Icon'

/** Создание элемента справочника с одним полем «Название» (цвет / размер). */
export function DictItemSheet({
  title,
  label,
  placeholder,
  create,
  onDone,
  onClose,
}: {
  title: string
  label: string
  placeholder: string
  create: (name: string, requestId?: string) => Promise<{ message: string }>
  onDone: () => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Стабильный id на всю жизнь листа — повтор при обрыве сети не задваивает запись.
  const reqId = useRef(newRequestId())

  async function submit() {
    const value = name.trim()
    if (!value) { setError('Введите название'); return }
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await create(value, reqId.current)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>{title}</h3>

        <div className="field" style={{ marginTop: 8 }}>
          <div className="flabel">{label} <span className="req">*</span></div>
          <input
            className="input"
            type="text"
            placeholder={placeholder}
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
        </div>

        {error && (
          <div className="alert" style={{ marginTop: 4 }}>
            <Icon name="alert" size={15} />
            {error}
          </div>
        )}

        <div className="line-row" style={{ marginTop: 10 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn" style={{ flex: 2 }} disabled={saving} onClick={() => void submit()}>
            {saving ? '…' : 'Добавить'}
          </button>
        </div>
      </div>
    </div>
  )
}
