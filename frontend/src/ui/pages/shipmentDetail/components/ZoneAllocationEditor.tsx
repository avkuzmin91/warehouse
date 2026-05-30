import { useState } from 'react'
import type { ShipmentLine } from '../../../../api/shipmentsApi'
import { setShipmentLineZones } from '../../../../api/shipmentsApi'
import { Combobox } from '../../../data/Combobox'
import { NumberStep } from '../../../features/inventory/shared/NumberStep'
import { Icon } from '../../../primitives/Icon'

type ZoneOption = { id: string; name: string }

type Draft = { zoneId: string; qty: number }

type Props = {
  docId: string
  line: ShipmentLine
  zoneOptions: ZoneOption[]
  /** Доступный годный остаток по зонам для этой позиции (ключ — zoneId, '' = без зоны). */
  available: Record<string, number>
  disabled?: boolean
  onSaved: () => Promise<void>
}

export function ZoneAllocationEditor({ docId, line, zoneOptions, available, disabled, onSaved }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(
    line.zones.length > 0
      ? line.zones.map((z) => ({ zoneId: z.storage_zone_id ?? '', qty: z.qty }))
      : [{ zoneId: '', qty: line.qty }],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const allocated = drafts.reduce((s, d) => s + d.qty, 0)
  const remaining = line.qty - allocated
  const savedKey = JSON.stringify(
    line.zones.map((z) => ({ zoneId: z.storage_zone_id ?? '', qty: z.qty })).sort((a, b) => a.zoneId.localeCompare(b.zoneId)),
  )
  const draftKey = JSON.stringify([...drafts].sort((a, b) => a.zoneId.localeCompare(b.zoneId)))
  const dirty = savedKey !== draftKey
  const duplicateZone = new Set(drafts.map((d) => d.zoneId)).size !== drafts.length
  const overByZone = drafts.some((d) => d.qty > (available[d.zoneId] ?? 0))

  const canSave = dirty && remaining === 0 && !duplicateZone && !overByZone && !saving && !disabled

  function update(i: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }
  function addRow() {
    setDrafts((prev) => [...prev, { zoneId: '', qty: Math.max(1, line.qty - allocated) }])
  }
  function removeRow(i: number) {
    setDrafts((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await setShipmentLineZones(
        docId,
        line.id,
        drafts.map((d) => {
          const opt = zoneOptions.find((z) => z.id === d.zoneId)
          return {
            storage_zone_id: d.zoneId || null,
            storage_zone_name: opt?.name ?? null,
            qty: d.qty,
          }
        }),
      )
      await onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: '8px 0 4px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {drafts.map((d, i) => {
        const avail = available[d.zoneId] ?? 0
        const over = d.qty > avail
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 200 }}>
              <Combobox
                value={d.zoneId}
                placeholder="Зона хранения"
                options={zoneOptions.map((z) => ({ value: z.id, label: z.name }))}
                onChange={(v) => update(i, { zoneId: String(v ?? '') })}
                disabled={disabled}
                clearable
              />
            </div>
            <NumberStep value={d.qty} onChange={(v) => update(i, { qty: Math.max(1, v) })} tone={over ? 'warning' : 'normal'} disabled={disabled} />
            <span className="t-sub" style={{ color: over ? 'var(--c-warning)' : 'var(--c-text-subtle)', fontSize: 12 }}>
              доступно {avail}
            </span>
            {drafts.length > 1 && (
              <button className="btn ghost icon sm" onClick={() => removeRow(i)} disabled={disabled} title="Убрать зону">
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
        <button className="btn ghost sm" onClick={addRow} disabled={disabled}>
          <Icon name="plus" size={12} />Добавить зону
        </button>
        <span
          className="t-sub"
          style={{ fontSize: 12, color: remaining === 0 ? 'var(--c-success)' : 'var(--c-text-muted)' }}
        >
          Распределено {allocated} из {line.qty}
          {remaining !== 0 && ` (осталось ${remaining})`}
        </span>
        {duplicateZone && <span className="t-sub" style={{ fontSize: 12, color: 'var(--c-warning)' }}>Зоны не должны повторяться</span>}
        <div style={{ flex: 1 }} />
        {dirty && (
          <button className="btn sm primary" onClick={() => { void handleSave() }} disabled={!canSave}>
            <Icon name="save" size={12} />Сохранить
          </button>
        )}
      </div>
      {error && <span className="t-sub" style={{ fontSize: 12, color: 'var(--c-danger)' }}>{error}</span>}
    </div>
  )
}
