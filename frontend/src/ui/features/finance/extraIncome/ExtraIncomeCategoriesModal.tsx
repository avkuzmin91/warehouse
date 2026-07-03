import { useEffect, useState } from 'react'
import {
  createExtraIncomeCategory,
  deleteExtraIncomeCategory,
  getExtraIncomeCategories,
  updateExtraIncomeCategory,
} from '../../../../api/extraIncomeApi'
import type { ExtraIncomeCategory } from '../../../../api/extraIncomeApi'
import { Modal } from '../../../feedback/Modal'
import { Icon } from '../../../primitives/Icon'
import { useToast } from '../../../feedback/Toast'
import { useConfirm } from '../../../feedback/ConfirmDialog'

export function ExtraIncomeCategoriesModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<ExtraIncomeCategory[]>([])
  const [adding, setAdding] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  function reload() {
    getExtraIncomeCategories().then(setItems).catch((e) => toast(e.message, 'error'))
  }
  useEffect(reload, []) // eslint-disable-line react-hooks/exhaustive-deps

  function add() {
    const name = adding.trim()
    if (!name) return
    setBusy(true)
    createExtraIncomeCategory(name)
      .then(() => { setAdding(''); reload(); onChanged() })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  function saveEdit(id: string) {
    const name = editName.trim()
    if (!name) return
    setBusy(true)
    updateExtraIncomeCategory(id, name)
      .then(() => { setEditId(null); reload(); onChanged() })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  async function remove(item: ExtraIncomeCategory) {
    const ok = await confirm({
      title: 'Удалить вид работы?',
      body: `«${item.name}» исчезнет из списка выбора. Ранее заведённые записи сохранят прежнее значение.`,
      danger: true, confirmLabel: 'Удалить',
    })
    if (!ok) return
    deleteExtraIncomeCategory(item.id)
      .then(() => { reload(); onChanged() })
      .catch((e) => toast(e.message, 'error'))
  }

  return (
    <Modal open onClose={onClose} width={460} title="Виды доп. работ"
      subtitle="Переборка брака, переклейка ШК — добавляйте и переименовывайте под свои реалии"
      footer={<button className="btn primary" onClick={onClose}><Icon name="check" size={14} />Готово</button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', padding: '6px 0' }}>Пусто — добавьте первую запись.</div>
        ) : items.map((it) => (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', border: '1px solid var(--c-border)', borderRadius: 'var(--r-md)' }}>
            {editId === it.id ? (
              <>
                <input
                  className="input sm" style={{ flex: 1 }} autoFocus value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(it.id); if (e.key === 'Escape') setEditId(null) }}
                />
                <button className="btn ghost icon sm" title="Сохранить" disabled={busy} onClick={() => saveEdit(it.id)}><Icon name="check" size={13} /></button>
                <button className="btn ghost icon sm" title="Отмена" onClick={() => setEditId(null)}><Icon name="x" size={13} /></button>
              </>
            ) : (
              <>
                <span style={{ flex: 1, fontSize: 13 }}>{it.name}</span>
                <button className="btn ghost icon sm" title="Переименовать" onClick={() => { setEditId(it.id); setEditName(it.name) }}><Icon name="edit" size={13} /></button>
                <button className="btn ghost icon sm" title="Удалить" onClick={() => remove(it)}><Icon name="trash" size={13} /></button>
              </>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="input sm" style={{ flex: 1 }} placeholder="Новый вид работы" value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="btn sm" disabled={busy || !adding.trim()} onClick={add}><Icon name="plus" size={13} />Добавить</button>
      </div>
    </Modal>
  )
}
