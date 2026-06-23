import { useState } from 'react'
import { assignProductSku } from '../../api/productsApi'
import { Icon } from '../../components/Icon'

/** Присвоение/смена базового SKU товара для строки «ожидает SKU». */
export function AssignSkuSheet({
  productId,
  productName,
  variantLabel,
  currentSku,
  onDone,
  onClose,
}: {
  productId: string
  productName: string
  variantLabel: string | null
  currentSku: string | null
  onDone: (skuBase: string) => void
  onClose: () => void
}) {
  const [sku, setSku] = useState(currentSku ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const value = sku.trim()
    if (!value) { setError('Введите SKU'); return }
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await assignProductSku(productId, value)
      onDone(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить SKU')
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h3>{currentSku ? 'Изменить SKU' : 'Указать SKU'}</h3>
        <div className="line-sub" style={{ marginBottom: 14 }}>
          {productName}{variantLabel ? ` · ${variantLabel}` : ''}
        </div>

        <div className="field">
          <div className="flabel">Базовый SKU <span className="req">*</span></div>
          <input
            className="input"
            type="text"
            autoCapitalize="characters"
            autoCorrect="off"
            placeholder="Например, ABC-001"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
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
            {saving ? '…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
