import { useEffect, useState } from 'react'
import {
  createExpenseDictItem,
  deleteExpenseDictItem,
  getExpenseDict,
  updateExpenseDictItem,
} from '../../../../api/expensesApi'
import type { ExpenseDictItem, ExpenseDictKind } from '../../../../api/expensesApi'
import { Modal } from '../../../feedback/Modal'
import { Icon } from '../../../primitives/Icon'
import { useToast } from '../../../feedback/Toast'
import { useConfirm } from '../../../feedback/ConfirmDialog'

export function ExpenseDictsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  return (
    <Modal open onClose={onClose} width={620} title="Справочники расходов"
      subtitle="Категории и источники оплаты — добавляйте и переименовывайте под свои реалии"
      footer={<button className="btn primary" onClick={onClose}><Icon name="check" size={14} />Готово</button>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <DictColumn kind="categories" title="Категории" icon="book" addPlaceholder="Новая категория" onChanged={onChanged} />
        <DictColumn kind="payment-sources" title="Источники оплаты" icon="wallet" addPlaceholder="Новая карта / счёт" onChanged={onChanged} />
      </div>
    </Modal>
  )
}

function DictColumn({ kind, title, icon, addPlaceholder, onChanged }: {
  kind: ExpenseDictKind
  title: string
  icon: 'book' | 'wallet'
  addPlaceholder: string
  onChanged: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [items, setItems] = useState<ExpenseDictItem[]>([])
  const [adding, setAdding] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  function reload() {
    getExpenseDict(kind).then(setItems).catch((e) => toast(e.message, 'error'))
  }
  useEffect(reload, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  function add() {
    const name = adding.trim()
    if (!name) return
    setBusy(true)
    createExpenseDictItem(kind, name)
      .then(() => { setAdding(''); reload(); onChanged() })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  function saveEdit(id: string) {
    const name = editName.trim()
    if (!name) return
    setBusy(true)
    updateExpenseDictItem(kind, id, name)
      .then(() => { setEditId(null); reload(); onChanged() })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setBusy(false))
  }

  async function remove(item: ExpenseDictItem) {
    const ok = await confirm({
      title: 'Удалить запись?',
      body: `«${item.name}» исчезнет из списка выбора. Ранее заведённые расходы сохранят прежнее значение.`,
      danger: true, confirmLabel: 'Удалить',
    })
    if (!ok) return
    deleteExpenseDictItem(kind, item.id)
      .then(() => { reload(); onChanged() })
      .catch((e) => toast(e.message, 'error'))
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name={icon} size={14} style={{ color: 'var(--c-text-muted)' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--c-text-subtle)' }}>{items.length}</span>
      </div>

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
          className="input sm" style={{ flex: 1 }} placeholder={addPlaceholder} value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="btn sm" disabled={busy || !adding.trim()} onClick={add}><Icon name="plus" size={13} />Добавить</button>
      </div>
    </div>
  )
}
