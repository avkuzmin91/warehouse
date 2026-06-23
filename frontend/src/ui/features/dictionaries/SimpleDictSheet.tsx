import { useState, useEffect } from 'react'
import { fmtDateLong } from '../../../utils/format'
import {
  createSimpleDictionaryItem,
  updateSimpleDictionaryItem,
  createProductType,
  updateProductType,
  createSize,
  updateSize,
  fetchSimpleDictionaryPage,
  setUnloadingZonePacking,
  setUnloadingZoneShipping,
} from '../../../api/adminApi'
import type { DictionaryItem, ProductTypeDictionaryItem, SizeItem } from '../../../api/domainTypes'
import { Drawer } from '../../feedback/Drawer'
import { useConfirm } from '../../feedback/ConfirmDialog'
import { useToast } from '../../feedback/Toast'
import { Field, Input } from '../../primitives/Input'
import { Toggle } from '../../primitives/Checkbox'
import { Badge } from '../../primitives/Badge'
import { Icon } from '../../primitives/Icon'

type AnyDictItem = DictionaryItem | ProductTypeDictionaryItem | SizeItem

type ZoneRoleKey = 'packing' | 'shipping'

const ZONE_ROLE_FIELD: Record<ZoneRoleKey, 'is_packing_zone' | 'is_shipping_zone'> = {
  packing: 'is_packing_zone',
  shipping: 'is_shipping_zone',
}

const ZONE_ROLES: {
  key: ZoneRoleKey
  label: string
  instrumental: string
  icon: 'forklift' | 'truckOut'
  tone: 'info' | 'warning'
  assign: (id: string) => Promise<{ message: string }>
}[] = [
  { key: 'packing', label: 'Зона упаковки', instrumental: 'зоной упаковки', icon: 'forklift', tone: 'info', assign: setUnloadingZonePacking },
  { key: 'shipping', label: 'Зона отгрузки', instrumental: 'зоной отгрузки', icon: 'truckOut', tone: 'warning', assign: setUnloadingZoneShipping },
]

function zoneHasRole(zone: DictionaryItem, key: ZoneRoleKey): boolean {
  return !!zone[ZONE_ROLE_FIELD[key]]
}

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
  'own-warehouses': '/own-warehouses',
  carriers: '/carriers',
  'vehicle-types': '/vehicle-types',
  positions: '/positions',
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
  apiType: 'colors' | 'sizes' | 'product-types' | 'suppliers' | 'unloading-zones' | 'warehouses' | 'own-warehouses' | 'carriers' | 'vehicle-types' | 'positions' | 'reasons'
  initial?: AnyDictItem | null
}

export function SimpleDictSheet({ open, onClose, onSaved, isNew, kind, apiType, initial }: SimpleDictSheetProps) {
  const [name, setName] = useState('')
  const [colorHex, setColorHex] = useState(DEFAULT_COLOR_HEX)
  const [rentRub, setRentRub] = useState('')
  const [active, setActive] = useState(true)
  const [reqColor, setReqColor] = useState(false)
  const [reqSize, setReqSize] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zones, setZones] = useState<DictionaryItem[]>([])
  const [roleFlags, setRoleFlags] = useState<Record<ZoneRoleKey, boolean>>({ packing: false, shipping: false })
  const [assigning, setAssigning] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()

  const isZoneEdit = apiType === 'unloading-zones' && !isNew && !!initial

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    const initialColorHex = initial && 'color_hex' in initial ? initial.color_hex : null
    setColorHex(apiType === 'colors' ? normalizeColorHex(initialColorHex ?? initial?.name ?? '') ?? DEFAULT_COLOR_HEX : DEFAULT_COLOR_HEX)
    const initialRent = initial && 'rent_monthly_kopecks' in initial ? initial.rent_monthly_kopecks : null
    setRentRub(apiType === 'own-warehouses' && initialRent != null ? String(initialRent / 100) : '')
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
    setRoleFlags({
      packing: !!initial && 'is_packing_zone' in initial && !!initial.is_packing_zone,
      shipping: !!initial && 'is_shipping_zone' in initial && !!initial.is_shipping_zone,
    })
  }, [open, initial, apiType])

  useEffect(() => {
    if (!open || apiType !== 'unloading-zones' || isNew) return
    fetchSimpleDictionaryPage('/unloading-zones', 'name', { page: 1, limit: 100 })
      .then((res) => setZones(res.items))
      .catch(() => setZones([]))
  }, [open, apiType, isNew])

  async function handleAssignRole(role: (typeof ZONE_ROLES)[number]) {
    if (!initial) return
    const holder = zones.find((z) => z.id !== initial.id && zoneHasRole(z, role.key))
    const ok = await confirm({
      title: `Назначить ${role.instrumental}?`,
      body: holder
        ? `Роль «${role.label}» перейдёт с места «${holder.name}» на «${initial.name}».`
        : `Место «${initial.name}» станет ${role.instrumental}.`,
      confirmLabel: 'Назначить',
    })
    if (!ok) return
    setAssigning(true)
    try {
      await role.assign(initial.id)
      setRoleFlags((prev) => ({ ...prev, [role.key]: true }))
      setZones((prev) => prev.map((z) => ({
        ...z,
        [ZONE_ROLE_FIELD[role.key]]: z.id === initial.id,
      })))
      toast(`${role.label} назначена`, 'success')
      onSaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Ошибка', 'error')
    } finally {
      setAssigning(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Введите значение'); return }
    if (apiType === 'colors' && colorHex.trim() && !normalizeColorHex(colorHex)) {
      setError('Hex цвета должен быть в формате #RGB или #RRGGBB')
      return
    }
    const colorPayload = apiType === 'colors' ? { color_hex: normalizeColorHex(colorHex) } : {}
    let rentPayload: { rent_monthly_kopecks?: number | null } = {}
    if (apiType === 'own-warehouses') {
      const s = rentRub.trim().replace(',', '.')
      if (s) {
        const n = Number(s)
        if (!Number.isFinite(n) || n < 0) {
          setError('Аренда: укажите неотрицательную сумму в рублях')
          return
        }
        rentPayload = { rent_monthly_kopecks: Math.round(n * 100) }
      } else {
        rentPayload = { rent_monthly_kopecks: null }
      }
    }
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
          await createSimpleDictionaryItem(path, { name: name.trim(), is_active: active, ...colorPayload, ...rentPayload })
        }
      } else if (initial) {
        if (apiType === 'product-types') {
          await updateProductType(initial.id, { name: name.trim(), is_active: active, requires_color: reqColor, requires_size: reqSize })
        } else if (apiType === 'sizes') {
          await updateSize(initial.id, { name: name.trim(), is_active: active })
        } else {
          const path = _apiPath(apiType)
          await updateSimpleDictionaryItem(path, initial.id, { name: name.trim(), is_active: active, ...colorPayload, ...rentPayload })
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

      {apiType === 'own-warehouses' && (
        <Field label="Аренда, ₽ / мес" help="1-го числа каждого месяца автоматически создаётся расход типа «Аренда» со статусом «Ожидает оплаты». Оставьте пустым, если аренды нет.">
          <Input
            className="num"
            inputMode="decimal"
            placeholder="Например: 120000"
            value={rentRub}
            onChange={(e) => setRentRub(e.target.value)}
          />
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

      {isZoneEdit && initial && (
        <Field label="Роли зоны" help="Каждая роль назначена только одному месту хранения">
          <div className="col gap-8" style={{ padding: '10px 12px', background: 'var(--c-bg-sunken)', borderRadius: 6 }}>
            {ZONE_ROLES.map((role) => {
              const holder = zones.find((z) => z.id !== initial.id && zoneHasRole(z, role.key))
              return (
                <div key={role.key} className="row gap-8" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="row gap-8" style={{ fontSize: 13, fontWeight: 500 }}>
                      <Icon name={role.icon} size={13} />
                      {role.label}
                    </div>
                    <div className="text-xs subtle">
                      {roleFlags[role.key]
                        ? 'Чтобы снять роль, назначьте её другому месту'
                        : holder ? `Сейчас: ${holder.name}` : 'Не назначена'}
                    </div>
                  </div>
                  {roleFlags[role.key] ? (
                    <Badge tone={role.tone}>Назначена</Badge>
                  ) : (
                    <button
                      className="btn ghost sm"
                      disabled={assigning}
                      onClick={() => void handleAssignRole(role)}
                    >
                      Назначить
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </Field>
      )}

      {!isNew && initial && (
        <div style={{ padding: '12px 14px', background: 'var(--c-bg-sunken)', borderRadius: 6 }}>
          <div className="text-xs subtle" style={{ marginBottom: 6 }}>МЕТА</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, fontSize: 12.5 }}>
            <span className="muted">Создано</span>
            <span>{fmtDateLong(initial.created_at ?? null)}</span>
            <span className="muted">Изменено</span>
            <span>{fmtDateLong(initial.updated_at ?? null)}</span>
          </div>
        </div>
      )}
    </Drawer>
  )
}
