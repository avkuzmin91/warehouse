import { useState, useEffect } from 'react'
import {
  createSimpleDictionaryItem,
  updateSimpleDictionaryItem,
  createProductType,
  updateProductType,
  createSize,
  updateSize,
} from '../../../api/adminApi'
import type { DictionaryItem, ProductTypeDictionaryItem, SizeItem } from '../../../api/domainTypes'
import { Drawer } from '../../feedback/Drawer'
import { Field, Input } from '../../primitives/Input'
import { Toggle } from '../../primitives/Checkbox'
import { Icon } from '../../primitives/Icon'

type AnyDictItem = DictionaryItem | ProductTypeDictionaryItem | SizeItem

const DEFAULT_COLOR_HEX = '#1a1a18'

function normalizeColorHex(value: string): string | null {
  const s = value.trim()
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) return s
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) return `#${s}`
  return null
}

const SIMPLE_API_PATHS: Record<string, string> = {
  colors: '/colors',
  suppliers: '/suppliers',
  'unloading-zones': '/unloading-zones',
  warehouses: '/warehouses',
  carriers: '/carriers',
  reasons: '/defect-reasons',
}
function _apiPath(apiType: string) {
  return SIMPLE_API_PATHS[apiType] ?? '/colors'
}

interface SimpleDictSheetProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  isNew: boolean
  kind: string
  apiType: 'colors' | 'sizes' | 'product-types' | 'suppliers' | 'unloading-zones' | 'warehouses' | 'carriers' | 'reasons'
  initial?: AnyDictItem | null
}

export function SimpleDictSheet({ open, onClose, onSaved, isNew, kind, apiType, initial }: SimpleDictSheetProps) {
  const [name, setName] = useState('')
  const [colorHex, setColorHex] = useState(DEFAULT_COLOR_HEX)
  const [active, setActive] = useState(true)
  const [reqColor, setReqColor] = useState(false)
  const [reqSize, setReqSize] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    const initialColorHex = initial && 'color_hex' in initial ? initial.color_hex : null
    setColorHex(apiType === 'colors' ? normalizeColorHex(initialColorHex ?? initial?.name ?? '') ?? DEFAULT_COLOR_HEX : DEFAULT_COLOR_HEX)
    setActive(initial?.is_active ?? true)
    setError(null)
    if (apiType === 'product-types' && initial) {
      const pt = initial as ProductTypeDictionaryItem
      setReqColor(pt.requires_color ?? false)
      setReqSize(pt.requires_size ?? false)
    } else {
      setReqColor(false)
      setReqSize(false)
    }
  }, [open, initial, apiType])

  const handleSave = async () => {
    if (!name.trim()) { setError('Введите значение'); return }
    if (apiType === 'colors' && colorHex.trim() && !normalizeColorHex(colorHex)) {
      setError('Hex цвета должен быть в формате #RGB или #RRGGBB')
      return
    }
    const colorPayload = apiType === 'colors' ? { color_hex: normalizeColorHex(colorHex) } : {}
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        if (apiType === 'product-types') {
          await createProductType({ name: name.trim(), is_active: active, requires_color: reqColor, requires_size: reqSize })
        } else if (apiType === 'sizes') {
          await createSize({ name: name.trim(), is_active: active })
        } else {
          const path = _apiPath(apiType)
          await createSimpleDictionaryItem(path, { name: name.trim(), is_active: active, ...colorPayload })
        }
      } else if (initial) {
        if (apiType === 'product-types') {
          await updateProductType(initial.id, { name: name.trim(), is_active: active, requires_color: reqColor, requires_size: reqSize })
        } else if (apiType === 'sizes') {
          await updateSize(initial.id, { name: name.trim(), is_active: active })
        } else {
          const path = _apiPath(apiType)
          await updateSimpleDictionaryItem(path, initial.id, { name: name.trim(), is_active: active, ...colorPayload })
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const placeholder =
    kind === 'Размер' ? '44' :
    kind === 'Цвет' ? 'Бирюзовый' :
    kind === 'Тип товара' ? 'Футболка' : 'Новое значение'

  const swatchColor = normalizeColorHex(colorHex) ?? DEFAULT_COLOR_HEX

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? `Новый «${kind.toLowerCase()}»` : `${kind}: ${initial?.name ?? ''}`}
      subtitle={isNew ? 'Простой справочник — добавление значения' : 'Редактирование'}
      width={440}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>Отмена</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icon name="check" size={13} />
            {saving ? 'Сохранение…' : isNew ? 'Создать' : 'Сохранить'}
          </button>
        </>
      }
    >
      <Field label="Значение" required error={error ?? undefined}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Например: ${placeholder}`}
          autoFocus
        />
      </Field>

      {kind === 'Тип товара' && (
        <Field label="Атрибуты вариантов" help="Какие признаки требует тип при создании товара">
          <div className="col gap-8" style={{ padding: '8px 10px', background: 'var(--c-bg-sunken)', borderRadius: 6 }}>
            <Toggle checked={reqColor} onChange={setReqColor} label="Имеет цвет" />
            <Toggle checked={reqSize} onChange={setReqSize} label="Имеет размер" />
          </div>
        </Field>
      )}

      {kind === 'Цвет' && (
        <Field label="Hex / визуальное обозначение">
          <div className="row gap-8">
            <div style={{ width: 30, height: 30, borderRadius: 6, background: swatchColor, border: '1px solid var(--c-border)', flexShrink: 0 }} />
            <Input
              className="mono"
              placeholder="#1a1a18"
              value={colorHex}
              onChange={(e) => setColorHex(e.target.value)}
            />
          </div>
        </Field>
      )}

      <Field label="Статус" help="Архивные значения скрыты, но не удалены">
        <div style={{ padding: '10px 12px', background: 'var(--c-bg-sunken)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Toggle checked={active} onChange={setActive} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{active ? 'Активно' : 'Архив'}</div>
            <div className="text-xs subtle">{active ? 'Доступно для выбора в формах' : 'Не появляется в списках выбора'}</div>
          </div>
        </div>
      </Field>

      {!isNew && initial && (
        <div style={{ padding: '12px 14px', background: 'var(--c-bg-sunken)', borderRadius: 6 }}>
          <div className="text-xs subtle" style={{ marginBottom: 6 }}>МЕТА</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, fontSize: 12.5 }}>
            <span className="muted">Создано</span>
            <span>{initial.created_at ? new Date(initial.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span>
            <span className="muted">Изменено</span>
            <span>{initial.updated_at ? new Date(initial.updated_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span>
          </div>
        </div>
      )}
    </Drawer>
  )
}
