import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { useHardwareBack } from '../../nav/backHandlers'

/** Правка упаковки строки отгрузки (короба/палеты) менеджером. Работает на любом
 *  статусе, кроме аннулированной, — кладовщик на подготовке собирает по этим числам. */
export function PackQtySheet({
  productName,
  boxesQty,
  palletsQty,
  onSave,
  onClose,
}: {
  productName: string
  boxesQty: number | null
  palletsQty: number | null
  /** Сохраняет упаковку строки; true — успех (родитель закроет лист). */
  onSave: (patch: { boxes_qty: number | null; pallets_qty: number | null }) => Promise<boolean>
  onClose: () => void
}) {
  const [boxes, setBoxes] = useState(boxesQty != null ? String(boxesQty) : '')
  const [pallets, setPallets] = useState(palletsQty != null ? String(palletsQty) : '')
  const [saving, setSaving] = useState(false)

  useHardwareBack(() => { if (!saving) onClose() })

  function parse(raw: string): number | null {
    const t = raw.trim()
    return t === '' ? null : Math.max(0, parseInt(t, 10))
  }

  async function submit() {
    if (saving) return
    setSaving(true)
    const ok = await onSave({ boxes_qty: parse(boxes), pallets_qty: parse(pallets) })
    if (!ok) setSaving(false)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Упаковка</h3>
        <div className="line-sub" style={{ marginBottom: 14 }}>
          «{productName}» — кладовщик собирает отгрузку по этим числам
        </div>

        <div className="field">
          <div className="flabel">Короба</div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="—"
            value={boxes}
            onChange={(e) => setBoxes(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="field">
          <div className="flabel">Палеты</div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="—"
            value={pallets}
            onChange={(e) => setPallets(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="line-row" style={{ marginTop: 10 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn" style={{ flex: 2 }} disabled={saving} onClick={() => void submit()}>
            <Icon name="check" size={14} /> {saving ? <span className="spin spin-sm" /> : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
