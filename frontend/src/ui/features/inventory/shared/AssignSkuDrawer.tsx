import { useState } from 'react'
import { Drawer } from '../../../feedback/Drawer'
import { Icon } from '../../../primitives/Icon'
import { Field, Input } from '../../../primitives/Input'

type Props = {
  productName: string
  variantLabel?: string | null
  // Текущий базовый SKU — задан при изменении (префилл), пуст/опущен при первичном вводе.
  currentSku?: string | null
  onSubmit: (skuBase: string) => Promise<void>
  onClose: () => void
}

/** Ввод/изменение базового SKU товара прямо из формирования отгрузки.
 *
 * SKU принадлежит товару и присваивается всем его вариантам (по цвету/размеру) —
 * поэтому вводится базовый артикул, а не по конкретной строке. Сама запись идёт через
 * PATCH /products/{id} (sku_base); здесь только сбор значения. */
export function AssignSkuDrawer({ productName, variantLabel, currentSku, onSubmit, onClose }: Props) {
  const isEdit = !!(currentSku && currentSku.trim())
  const [sku, setSku] = useState(currentSku?.trim() ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const trimmed = sku.trim()

  async function handleSave() {
    if (!trimmed) { setError('Укажите SKU'); return }
    if (isEdit && trimmed === currentSku?.trim()) { setError('SKU не изменился'); return }
    setError('')
    setSaving(true)
    try {
      await onSubmit(trimmed)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={isEdit ? 'Изменить SKU товара' : 'Указать SKU товара'}
      subtitle={variantLabel ? `${productName} · ${variantLabel}` : productName}
      width={420}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <button className="btn ghost" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn primary" onClick={() => void handleSave()} disabled={saving || !trimmed}>
            <Icon name="check" size={14} />Сохранить
          </button>
        </div>
      }
    >
      <div style={{ fontSize: 12.5, color: 'var(--c-text-subtle)', lineHeight: 1.5, marginBottom: 16 }}>
        {isEdit
          ? 'Базовый артикул будет изменён у товара и пересчитан у всех его вариантов (по цвету и размеру).'
          : 'У товара нет SKU. Базовый артикул будет присвоен товару и всем его вариантам (по цвету и размеру) — после этого отгрузку можно запланировать.'}
      </div>
      <Field label="Базовый SKU" required style={{ marginBottom: 0 }}>
        <Input
          value={sku}
          autoFocus
          placeholder="Например, ABC-001"
          onChange={(e) => { setSku(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter' && trimmed) void handleSave() }}
        />
      </Field>
      {error && (
        <div style={{ color: 'var(--c-danger)', fontSize: 12.5, marginTop: 10 }}>{error}</div>
      )}
    </Drawer>
  )
}
