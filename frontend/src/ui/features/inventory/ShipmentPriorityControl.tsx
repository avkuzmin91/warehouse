import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { updateShipmentPriority, type ShipmentListItem } from '../../../api/shipmentsApi'
import { useToast } from '../../feedback/Toast'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canEditShipmentPriority } from '../../../utils/access'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'

type ShipmentPriorityControlProps = {
  shipment: Pick<ShipmentListItem, 'id' | 'status' | 'priority_rank'>
  canEdit: boolean
  onSaved: (priorityRank: number | null) => void
}

function stop(e: MouseEvent<HTMLElement>) {
  e.stopPropagation()
}

function priorityText(priorityRank: number | null): string {
  return priorityRank ? `#${priorityRank}` : '—'
}

export function ShipmentPriorityControl({ shipment, canEdit, onSaved }: ShipmentPriorityControlProps) {
  const toast = useToast()
  const { user } = useCurrentUser()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [draft, setDraft] = useState(shipment.priority_rank ? String(shipment.priority_rank) : '')
  const [saving, setSaving] = useState(false)

  const current = shipment.priority_rank ? String(shipment.priority_rank) : ''

  useEffect(() => {
    setDraft(current)
    setMode('view')
  }, [shipment.id, shipment.priority_rank])

  const editable = canEdit && canEditShipmentPriority(user) && shipment.status === 'packing'
  const dirty = draft.trim() !== current

  async function save() {
    const raw = draft.trim()
    const parsed = raw === '' ? null : Number(raw)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 999)) {
      toast('Приоритет должен быть числом от 1 до 999', 'error')
      return
    }
    setSaving(true)
    try {
      await updateShipmentPriority(shipment.id, parsed)
      toast(parsed === null ? 'Приоритет снят' : `Приоритет ${priorityText(parsed)} сохранён`, 'success')
      onSaved(parsed)
      setMode('view')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка сохранения приоритета', 'error')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(current)
    setMode('view')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation()
    if (e.key === 'Enter' && dirty && !saving) void save()
    if (e.key === 'Escape') cancel()
  }

  if (!editable) {
    return shipment.priority_rank ? (
      <Badge tone="warning">{priorityText(shipment.priority_rank)}</Badge>
    ) : (
      <span style={{ color: 'var(--c-text-faint)', fontSize: 12 }}>—</span>
    )
  }

  if (mode === 'view') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={stop}>
        {shipment.priority_rank ? (
          <>
            <Badge tone="warning">{priorityText(shipment.priority_rank)}</Badge>
            <button
              type="button"
              className="btn ghost sm icon"
              title="Изменить приоритет"
              onClick={() => setMode('edit')}
            >
              <Icon name="edit" size={13} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn ghost sm"
            title="Указать приоритет в очереди отгрузок"
            onClick={() => setMode('edit')}
            style={{ color: 'var(--c-text-subtle)', height: 28 }}
          >
            <Icon name="plus" size={12} /> приоритет
          </button>
        )}
      </span>
    )
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={stop}>
      <input
        className="input sm mono"
        type="number"
        min={1}
        max={999}
        value={draft}
        placeholder="—"
        title="Приоритет в очереди отгрузок"
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{ width: 58, height: 28, textAlign: 'center', padding: '0 6px' }}
      />
      <button
        type="button"
        className="btn ghost sm icon"
        title="Сохранить приоритет"
        disabled={!dirty || saving}
        onClick={() => void save()}
      >
        <Icon name={saving ? 'refresh' : 'check'} size={13} style={saving ? { animation: 'spin 0.7s linear infinite' } : undefined} />
      </button>
      <button
        type="button"
        className="btn ghost sm icon"
        title="Отмена"
        disabled={saving}
        onClick={cancel}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  )
}
