import { useState } from 'react'
import { Icon } from '../../components/Icon'

/** Ввод кратности упаковки товара (штук в коробе / коробов на палете). Значения живут
 *  на карточке товара и переиспользуются на всех будущих отгрузках. */
export function PackMultiplicitySheet({
  productName,
  itemsPerBox,
  boxesPerPallet,
  onSave,
  onClose,
}: {
  productName: string
  itemsPerBox: number | null
  boxesPerPallet: number | null
  /** Пишет кратность в карточку товара; true — успех (родитель закроет лист). */
  onSave: (patch: { items_per_box: number | null; boxes_per_pallet: number | null }) => Promise<boolean>
  onClose: () => void
}) {
  const [perBox, setPerBox] = useState(itemsPerBox != null ? String(itemsPerBox) : '')
  const [boxesPer, setBoxesPer] = useState(boxesPerPallet != null ? String(boxesPerPallet) : '')
  const [saving, setSaving] = useState(false)

  function parse(raw: string): number | null {
    const t = raw.trim()
    return t === '' ? null : Math.max(0, parseInt(t, 10))
  }

  async function submit() {
    if (saving) return
    setSaving(true)
    const ok = await onSave({ items_per_box: parse(perBox), boxes_per_pallet: parse(boxesPer) })
    if (!ok) setSaving(false)
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>Кратность упаковки</h3>
        <div className="line-sub" style={{ marginBottom: 14 }}>
          «{productName}» — сохранится для всех отгрузок товара
        </div>

        <div className="field">
          <div className="flabel">Штук в коробе</div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="—"
            value={perBox}
            onChange={(e) => setPerBox(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="field">
          <div className="flabel">Коробов на палете</div>
          <input
            className="input num"
            inputMode="numeric"
            placeholder="—"
            value={boxesPer}
            onChange={(e) => setBoxesPer(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="line-row" style={{ marginTop: 10 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn" style={{ flex: 2 }} disabled={saving} onClick={() => void submit()}>
            <Icon name="check" size={14} /> {saving ? '…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
