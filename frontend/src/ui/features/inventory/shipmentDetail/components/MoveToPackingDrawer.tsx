import { useMemo, useState } from 'react'
import { moveShipmentLineToPacking } from '../../../../../api/shipmentsApi'
import type { ShipmentLine, ShipmentMoveAllocation } from '../../../../../api/shipmentsApi'
import { Drawer } from '../../../../feedback/Drawer'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { NumberStep } from '../../../inventory/shared/NumberStep'
import { Icon } from '../../../../primitives/Icon'
import { useToast } from '../../../../feedback/Toast'

export type MoveZoneOption = { id: string; name: string; available: number }

type Row = { zoneId: string; qty: number }

type Props = {
  docId: string
  line: ShipmentLine
  // transfer — первичная передача «В плане»; replenish — подвоз «На упаковке».
  mode: 'transfer' | 'replenish'
  zoneOptions: MoveZoneOption[]
  onClose: () => void
  onDone: () => Promise<void> | void
}

export function MoveToPackingDrawer({ docId, line, mode, zoneOptions, onClose, onDone }: Props) {
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>([{ zoneId: '', qty: 0 }])
  const [saving, setSaving] = useState(false)

  const pool = line.available_for_pack
  // replenish: сколько годного ещё не хватает до плана при текущем столе; transfer: сколько ещё не передано.
  const need = mode === 'replenish'
    ? Math.max(0, line.qty - line.packed_good - pool)
    : Math.max(0, line.qty - pool)

  const availById = useMemo(() => {
    const m = new Map<string, number>()
    for (const z of zoneOptions) m.set(z.id, z.available)
    return m
  }, [zoneOptions])

  const total = rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
  const noZones = zoneOptions.length === 0

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() { setRows((prev) => [...prev, { zoneId: '', qty: 0 }]) }
  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  function validate(): string | null {
    const seen = new Set<string>()
    let any = false
    for (const r of rows) {
      if (!r.zoneId && r.qty <= 0) continue
      if (!r.zoneId) return 'Выберите место в каждой строке'
      if (r.qty <= 0) return 'Укажите количество больше нуля'
      if (seen.has(r.zoneId)) return 'Место указано дважды — объедините строки'
      seen.add(r.zoneId)
      const avail = availById.get(r.zoneId) ?? 0
      if (r.qty > avail) return `В месте доступно ${avail} шт — уменьшите количество`
      any = true
    }
    if (!any) return 'Добавьте хотя бы одно место с количеством'
    return null
  }

  async function submit() {
    const err = validate()
    if (err) { toast(err, 'error'); return }
    const allocations: ShipmentMoveAllocation[] = rows
      .filter((r) => r.zoneId && r.qty > 0)
      .map((r) => ({ from_zone_id: r.zoneId, qty: r.qty }))
    setSaving(true)
    try {
      await moveShipmentLineToPacking(docId, line.id, allocations)
      await onDone()
      toast('Товар передан на упаковку', 'success')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка перемещения', 'error')
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'replenish' ? 'Передать ещё на упаковку' : 'Передать на упаковку'

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      subtitle={`${line.product_name} · ${line.product_sku}`}
      width={460}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
            К перемещению <b className="num" style={{ color: 'var(--c-text)' }}>{total}</b> шт
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={onClose} disabled={saving}>Отмена</button>
            <button className="btn primary" onClick={submit} disabled={saving || noZones || total <= 0}>
              <Icon name="forklift" size={14} />{mode === 'replenish' ? 'Передать ещё' : 'Передать'}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 12.5 }}>
        <span style={{ color: 'var(--c-text-subtle)' }}>
          План <b className="num" style={{ color: 'var(--c-text)' }}>{line.qty}</b>
        </span>
        <span style={{ color: 'var(--c-text-subtle)' }}>
          На упаковке <b className="num" style={{ color: 'var(--c-text)' }}>{pool}</b>
        </span>
        {mode === 'replenish' && (
          <span style={{ color: 'var(--c-text-subtle)' }}>
            Упаковано годных <b className="num" style={{ color: 'var(--c-success)' }}>{line.packed_good}</b>
          </span>
        )}
        <span style={{ color: 'var(--c-text-subtle)', marginLeft: 'auto' }}>
          {mode === 'replenish' ? 'Не хватает' : 'Осталось передать'}{' '}
          <b className="num" style={{ color: need > 0 ? 'var(--c-warning)' : 'var(--c-success)' }}>{need}</b>
        </span>
      </div>

      {noZones ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          Нет свободного товара на хранении для этой позиции — переместить нечего.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row, i) => {
              const options: ComboboxOption[] = zoneOptions.map((z) => ({
                value: z.id,
                label: z.name,
                sub: `на хранении ${z.available.toLocaleString('ru-RU')} шт`,
              }))
              const avail = row.zoneId ? (availById.get(row.zoneId) ?? 0) : 0
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Combobox
                      value={row.zoneId || null}
                      placeholder="Выберите место"
                      options={options}
                      onChange={(v) => setRow(i, { zoneId: String(v ?? '') })}
                      disabled={saving}
                      clearable
                    />
                    {row.zoneId && (
                      <div style={{ marginTop: 3, fontSize: 11.5, color: 'var(--c-text-subtle)' }}>
                        доступно {avail.toLocaleString('ru-RU')} шт
                      </div>
                    )}
                  </div>
                  <NumberStep
                    value={row.qty}
                    min={0}
                    onChange={(v) => setRow(i, { qty: Math.max(0, v) })}
                    disabled={saving}
                    tone={row.zoneId && row.qty > avail ? 'warning' : 'normal'}
                    width={96}
                  />
                  <button
                    className="btn ghost icon sm"
                    style={{ marginTop: 2 }}
                    disabled={saving || rows.length <= 1}
                    title="Убрать строку"
                    onClick={() => removeRow(i)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              )
            })}
          </div>
          <button
            className="btn ghost sm"
            style={{ marginTop: 12 }}
            disabled={saving || rows.length >= zoneOptions.length}
            onClick={addRow}
          >
            <Icon name="plus" size={12} />Добавить место
          </button>
        </>
      )}
    </Drawer>
  )
}
