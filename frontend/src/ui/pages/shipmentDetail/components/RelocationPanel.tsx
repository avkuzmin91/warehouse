import { useMemo, useState } from 'react'
import { finishShipmentRelocation } from '../../../../api/shipmentsApi'
import type { ShipmentLine, ShipmentRelocateLine } from '../../../../api/shipmentsApi'
import type { DictionaryItem } from '../../../../api/domainTypes'
import { Combobox } from '../../../data/Combobox'
import type { ComboboxOption } from '../../../data/Combobox'
import { NumberStep } from '../../../features/inventory/shared/NumberStep'
import { Icon } from '../../../primitives/Icon'
import { LineIdentityCell } from '../../../features/inventory/receiptDetail/components/LineIdentityCell'
import { useToast } from '../../../feedback/Toast'

type Row = { zoneId: string; qty: number }
type LineAlloc = { good: Row[]; defect: Row[] }
type Kind = 'good' | 'defect'

type Props = {
  docId:       string
  lines:       ShipmentLine[]
  zoneOptions: DictionaryItem[]
  canEdit:     boolean
  onDone:      () => Promise<void> | void
}

function initRows(qty: number): Row[] {
  return qty > 0 ? [{ zoneId: '', qty }] : []
}

export function RelocationPanel({ docId, lines, zoneOptions, canEdit, onDone }: Props) {
  const toast = useToast()
  const packedLines = useMemo(
    () => lines.filter((l) => l.packed_good > 0 || l.packed_defect > 0),
    [lines],
  )
  const [allocs, setAllocs] = useState<Record<string, LineAlloc>>(() => {
    const next: Record<string, LineAlloc> = {}
    for (const l of packedLines) {
      next[l.id] = { good: initRows(l.packed_good), defect: initRows(l.packed_defect) }
    }
    return next
  })
  const [saving, setSaving] = useState(false)

  const zoneOpts: ComboboxOption[] = zoneOptions.map((z) => ({ value: z.id, label: z.name }))
  const zoneName = (id: string) => zoneOptions.find((z) => z.id === id)?.name ?? null

  function setRows(lineId: string, kind: Kind, rows: Row[]) {
    setAllocs((prev) => ({ ...prev, [lineId]: { ...prev[lineId], [kind]: rows } }))
  }
  function setRow(lineId: string, kind: Kind, i: number, patch: Partial<Row>) {
    const rows = allocs[lineId][kind].map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    setRows(lineId, kind, rows)
  }
  function addRow(lineId: string, kind: Kind) {
    setRows(lineId, kind, [...allocs[lineId][kind], { zoneId: '', qty: 0 }])
  }
  function removeRow(lineId: string, kind: Kind, i: number) {
    const rows = allocs[lineId][kind]
    if (rows.length <= 1) return
    setRows(lineId, kind, rows.filter((_, idx) => idx !== i))
  }

  function sumRows(rows: Row[]): number {
    return rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
  }

  function lineReady(line: ShipmentLine): boolean {
    const a = allocs[line.id]
    if (!a) return false
    for (const [kind, target] of [['good', line.packed_good], ['defect', line.packed_defect]] as const) {
      const rows = a[kind]
      if (sumRows(rows) !== target) return false
      if (rows.some((r) => r.qty > 0 && !r.zoneId)) return false
    }
    return true
  }

  const allReady = packedLines.every(lineReady)

  function validate(): string | null {
    for (const line of packedLines) {
      const a = allocs[line.id]
      for (const [kind, target, ru] of [
        ['good', line.packed_good, 'годный'],
        ['defect', line.packed_defect, 'брак'],
      ] as const) {
        const rows = a[kind]
        if (rows.some((r) => r.qty > 0 && !r.zoneId)) return `Выберите место для «${line.product_name}» (${ru})`
        const seen = new Set<string>()
        for (const r of rows) {
          if (!r.zoneId) continue
          if (seen.has(r.zoneId)) return `Место указано дважды для «${line.product_name}» (${ru})`
          seen.add(r.zoneId)
        }
        if (sumRows(rows) !== target) return `Разложите весь ${ru} для «${line.product_name}» (нужно ${target} шт.)`
      }
    }
    return null
  }

  async function submit() {
    const err = validate()
    if (err) { toast(err, 'error'); return }
    const payload: ShipmentRelocateLine[] = packedLines.map((line) => {
      const a = allocs[line.id]
      const toAlloc = (rows: Row[]) =>
        rows.filter((r) => r.zoneId && r.qty > 0).map((r) => ({ zone_id: r.zoneId, zone_name: zoneName(r.zoneId), qty: r.qty }))
      return { line_id: line.id, good: toAlloc(a.good), defect: toAlloc(a.defect) }
    })
    setSaving(true)
    try {
      await finishShipmentRelocation(docId, payload)
      await onDone()
      toast('Товар разложен по местам — отгрузка ожидает рейс', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка перемещения', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <Icon name="forklift" size={15} className="ic-accent" />
        <div className="card-head-title">Раскладка по местам хранения</div>
        {canEdit && (
          <div className="right">
            <button className="btn sm primary" disabled={saving || !allReady} onClick={() => { void submit() }}>
              <Icon name="check" size={12} />Готово к рейсу
            </button>
          </div>
        )}
      </div>

      {packedLines.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          Нет упакованного товара для раскладки.
        </div>
      ) : (
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!canEdit && (
            <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
              Кладовщик указывает места хранения для годного и брака, затем жмёт «Готово к рейсу».
            </div>
          )}
          {packedLines.map((line) => (
            <div
              key={line.id}
              style={{ border: '1px solid var(--c-border)', borderRadius: 'var(--r-lg)', padding: 12, background: 'var(--c-bg-elev)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <LineIdentityCell name={line.product_name} sku={line.product_sku} color={line.color_name} size={line.size_name} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {line.packed_good > 0 && (
                  <KindBlock
                    title="Годный" tone="var(--c-success)" target={line.packed_good}
                    rows={allocs[line.id].good} options={zoneOpts} disabled={!canEdit || saving}
                    onRow={(i, patch) => setRow(line.id, 'good', i, patch)}
                    onAdd={() => addRow(line.id, 'good')}
                    onRemove={(i) => removeRow(line.id, 'good', i)}
                    sum={sumRows(allocs[line.id].good)}
                  />
                )}
                {line.packed_defect > 0 && (
                  <KindBlock
                    title="Брак" tone="var(--c-danger)" target={line.packed_defect}
                    rows={allocs[line.id].defect} options={zoneOpts} disabled={!canEdit || saving}
                    onRow={(i, patch) => setRow(line.id, 'defect', i, patch)}
                    onAdd={() => addRow(line.id, 'defect')}
                    onRemove={(i) => removeRow(line.id, 'defect', i)}
                    sum={sumRows(allocs[line.id].defect)}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function KindBlock({
  title, tone, target, rows, options, disabled, onRow, onAdd, onRemove, sum,
}: {
  title:   string
  tone:    string
  target:  number
  rows:    Row[]
  options: ComboboxOption[]
  disabled: boolean
  onRow:   (i: number, patch: Partial<Row>) => void
  onAdd:   () => void
  onRemove: (i: number) => void
  sum:     number
}) {
  const left = target - sum
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12.5 }}>
        <span style={{ color: tone, fontWeight: 600 }}>{title}</span>
        <span style={{ color: 'var(--c-text-subtle)' }}>
          план <b className="num" style={{ color: 'var(--c-text)' }}>{target}</b>
        </span>
        <span style={{ marginLeft: 'auto', color: left === 0 ? 'var(--c-success)' : 'var(--c-warning)' }}>
          {left === 0 ? 'разложено' : `осталось ${left}`}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Combobox
                value={row.zoneId || null}
                placeholder="Выберите место"
                options={options}
                onChange={(v) => onRow(i, { zoneId: String(v ?? '') })}
                disabled={disabled}
                clearable
              />
            </div>
            <NumberStep
              value={row.qty}
              min={0}
              onChange={(v) => onRow(i, { qty: Math.max(0, v) })}
              disabled={disabled}
              width={96}
            />
            <button
              className="btn ghost icon sm"
              style={{ marginTop: 2 }}
              disabled={disabled || rows.length <= 1}
              title="Убрать строку"
              onClick={() => onRemove(i)}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
      <button className="btn ghost sm" style={{ marginTop: 8 }} disabled={disabled} onClick={onAdd}>
        <Icon name="plus" size={12} />Добавить место
      </button>
    </div>
  )
}
