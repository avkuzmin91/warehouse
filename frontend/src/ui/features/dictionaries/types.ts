import type { IconName } from '../../primitives/Icon'

export type DictionaryTypeId =
  | 'products'
  | 'product-types'
  | 'sizes'
  | 'colors'
  | 'clients'
  | 'suppliers'
  | 'locations'
  | 'warehouses'
  | 'own-warehouses'
  | 'reasons'
  | 'carriers'
  | 'vehicle-types'
  | 'positions'
  | 'packing-pricing'
  | 'pallet-pricing'
  | 'box-pricing'
  | 'storage-pricing'

export type DictionaryKind = 'rich' | 'simple' | 'empty'
export type DictionaryGroup = 'main' | 'pricing' | 'system'

export interface DictionaryType {
  id: DictionaryTypeId
  name: string
  icon: IconName
  kind: DictionaryKind
  group: DictionaryGroup
  /** Label for «Создать запись» button */
  createLabel: string
  /** Sheet kind string passed to SimpleDictSheet */
  sheetKind?: string
  /** Видимость только для админа (например ставки аренды наших складов) */
  adminOnly?: boolean
  /** Видимость только при финансовом доступе (admin/manager) — тарифы услуг */
  financeOnly?: boolean
}

export const DICTIONARY_TYPES: DictionaryType[] = [
  { id: 'products',      name: 'Товары',        icon: 'box',      kind: 'rich',   group: 'main',   createLabel: 'Новый товар' },
  { id: 'sizes',         name: 'Размеры',       icon: 'ruler',    kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Размер' },
  { id: 'colors',        name: 'Цвета',         icon: 'palette',  kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Цвет' },
  { id: 'clients',       name: 'Клиенты',       icon: 'users',    kind: 'rich',   group: 'main',   createLabel: 'Новый клиент' },
  { id: 'locations',     name: 'Места хранения', icon: 'grid',     kind: 'rich',   group: 'main',   createLabel: 'Сгенерировать ячейки' },
  { id: 'warehouses',       name: 'Точки логистики',  icon: 'map',      kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Точка логистики' },
  { id: 'own-warehouses',   name: 'Наши склады',      icon: 'building', kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Склад', adminOnly: true },
  { id: 'carriers',      name: 'Перевозчики',   icon: 'truckOut', kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Перевозчик' },
  { id: 'vehicle-types', name: 'Типы кузовов',   icon: 'truckOut', kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Тип кузова' },
  { id: 'positions',     name: 'Должности',     icon: 'users',    kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Должность' },
  { id: 'reasons',       name: 'Причины брака', icon: 'alert',    kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Причина брака' },
  { id: 'packing-pricing', name: 'Стоимость упаковки', icon: 'tag',    kind: 'rich', group: 'pricing', createLabel: '', financeOnly: true },
  { id: 'pallet-pricing',  name: 'Стоимость палета',   icon: 'layers', kind: 'rich', group: 'pricing', createLabel: '', financeOnly: true },
  { id: 'box-pricing',     name: 'Стоимость короба',   icon: 'box',    kind: 'rich', group: 'pricing', createLabel: '', financeOnly: true },
  { id: 'storage-pricing', name: 'Стоимость хранения', icon: 'clock',  kind: 'rich', group: 'pricing', createLabel: '', financeOnly: true },
  { id: 'product-types', name: 'Типы товаров',  icon: 'tag',      kind: 'simple', group: 'system', createLabel: 'Создать запись', sheetKind: 'Тип товара' },
]
