import { useState } from 'react'
import { placePackedShipment } from '../../../../../api/shipmentsApi'
import type { ShipmentLine } from '../../../../../api/shipmentsApi'
import type { DictionaryItem } from '../../../../../api/domainTypes'
import { Drawer } from '../../../../feedback/Drawer'
import { Combobox } from '../../../../data/Combobox'
import type { ComboboxOption } from '../../../../data/Combobox'
import { NumberStep } from '../../../inventory/shared/NumberStep'
import { Icon } from '../../../../primitives/Icon'
import { useToast } from '../../../../feedback/Toast'

type Row = { zoneId: string; qty: number }

type Props = {
  docId: string
  line: ShipmentLine
  zoneOptions: DictionaryItem[]
  onClose: () => void
  onDone: () => Promise<void> | void
}

// Размещение уже упакованного годного по местам, не завершая упаковку: товар становится
// «Готов к отгрузке» и доступен к рейсу, пока остальное ещё пакуется. Размещаем до pending
// (упаковано и ещё не размещено) — можно частично, остаток разложится позже или в финале.
export function PlacePackedDrawer({ docId, line, zoneOptions, onClose, onDone }: Props) {
  const toast = useToast()
  const pending = line.packed_pending_good
  const [rows, setRows] = useState<Row[]>([{ zoneId: '', qty: pending }])
  const [saving, setSaving] = useState(false)

  const total = rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0)
  const left = pending - total
  const zoneOpts: ComboboxOption[] = zoneOptions.map((z) => ({ value: z.id, label: z.name }))
  const zoneName = (id: string) => zoneOptions.find((z) => z.id === id)?.name ?? null

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() { setRows((prev) => [...prev, { zoneId: '', qty: 0 }]) }
  function removeRow(i: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  const [showReasons, setShowReasons] = useState(false)

  function collectReasons(): string[] {
    const reasons: string[] = []
    const filled = rows.filter((r) => r.zoneId || r.qty > 0)
    if (filled.length === 0) reasons.push('Добавьте место и количество')
    if (filled.some((r) => r.qty > 0 && !r.zoneId)) reasons.push('Выберите место в каждой строке')
    if (filled.some((r) => r.zoneId && r.qty <= 0)) reasons.push('Укажите количество больше нуля')
    const used = filled.filter((r) => r.zoneId).map((r) => r.zoneId)
    if (new Set(used).size !== used.length) reasons.push('Место указано дважды — объедините строки')
    if (total > pending) reasons.push(`Нельзя разместить больше упакованного (${pending} шт.)`)
    return reasons
  }

  const blockReasons = collectReasons()

  function handlePrimary() {
    if (blockReasons.length > 0) { setShowReasons(true); return }
    setShowReasons(false)
    void submit()
  }

  async function submit() {
    const err = collectReasons()[0]
    if (err) { toast(err, 'error'); return }
    const good = rows
      .filter((r) => r.zoneId && r.qty > 0)
      .map((r) => ({ zone_id: r.zoneId, zone_name: zoneName(r.zoneId), qty: r.qty }))
    setSaving(true)
    try {
      await placePackedShipment(docId, [{ line_id: line.id, good, defect: [] }])
      await onDone()
      toast('Готовое размещено по местам — доступно к отгрузке', 'success')
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка размещения', 'error')
    } finally {
      setSaving(false)
    }
  }

  const noZones = zoneOptions.length === 0

  return (
    <Drawer
      open
      onClose={onClose}
      title="Разместить готовое к отгрузке"
      subtitle={`${line.product_name} · ${line.product_sku}`}
      width={460}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: 12.5, color: 'var(--c-text-subtle)' }}>
            К размещению <b className="num" style={{ color: 'var(--c-text)' }}>{total}</b> шт
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" onClick={onClose} disabled={saving}>Отмена</button>
            <button className="btn primary" onClick={handlePrimary} disabled={saving || noZones}>
              <Icon name="check" size={14} />Разместить
            </button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 12.5 }}>
        <span style={{ color: 'var(--c-text-subtle)' }}>
          Упаковано годных <b className="num" style={{ color: 'var(--c-success)' }}>{line.packed_good}</b>
        </span>
        <span style={{ color: 'var(--c-text-subtle)', marginLeft: 'auto' }}>
          Осталось разместить{' '}
          <b className="num" style={{ color: left === 0 ? 'var(--c-success)' : 'var(--c-warning)' }}>{Math.max(0, left)}</b>
        </span>
      </div>

      {pending <= 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          Нет упакованного годного для размещения.
        </div>
      ) : noZones ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--c-text-subtle)', fontSize: 13 }}>
          Нет мест хранения для раскладки.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rows.map((row, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Combobox
                    value={row.zoneId || null}
                    placeholder="Выберите место"
                    options={zoneOpts}
                    onChange={(v) => setRow(i, { zoneId: String(v ?? '') })}
                    disabled={saving}
                    clearable
                  />
                </div>
                <NumberStep
                  value={row.qty}
                  min={0}
                  onChange={(v) => setRow(i, { qty: Math.max(0, v) })}
                  disabled={saving}
                  width={96}
                  height={34}
                />
                <button
                  className="btn ghost icon sm"
                  style={{ marginTop: 4 }}
                  disabled={saving || rows.length <= 1}
                  title="Убрать строку"
                  onClick={() => removeRow(i)}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn ghost sm"
            style={{ marginTop: 12 }}
            disabled={saving || rows.length >= zoneOptions.length}
            onClick={addRow}
          >
            <Icon name="plus" size={12} />Добавить место
          </button>
          {showReasons && blockReasons.length > 0 && (
            <div className="block-reasons" style={{ textAlign: 'left', marginTop: 10 }}>
              {blockReasons.map((r, i) => (
                <div key={i}>· {r}</div>
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}
