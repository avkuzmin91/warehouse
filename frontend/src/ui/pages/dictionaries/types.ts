import type { IconName } from '../../primitives/Icon'

export type DictionaryTypeId =
  | 'products'
  | 'product-types'
  | 'sizes'
  | 'colors'
  | 'clients'
  | 'suppliers'
  | 'unloading-zones'
  | 'warehouses'
  | 'reasons'
  | 'carriers'

export type DictionaryKind = 'rich' | 'simple' | 'empty'
export type DictionaryGroup = 'main' | 'system'

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
}

export const DICTIONARY_TYPES: DictionaryType[] = [
  { id: 'products',      name: 'Товары',        icon: 'box',      kind: 'rich',   group: 'main',   createLabel: 'Новый товар' },
  { id: 'sizes',         name: 'Размеры',       icon: 'ruler',    kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Размер' },
  { id: 'colors',        name: 'Цвета',         icon: 'palette',  kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Цвет' },
  { id: 'clients',       name: 'Клиенты',       icon: 'users',    kind: 'rich',   group: 'main',   createLabel: 'Новый клиент' },
  { id: 'suppliers',        name: 'Поставщики',       icon: 'cart',     kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Поставщик' },
  { id: 'unloading-zones', name: 'Зоны хранения',  icon: 'truckIn',  kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Зона хранения' },
  { id: 'warehouses',       name: 'Склады',           icon: 'map',      kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Склад' },
  { id: 'carriers',      name: 'Перевозчики',   icon: 'truckOut', kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Перевозчик' },
  { id: 'reasons',       name: 'Причины брака', icon: 'alert',    kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Причина брака' },
  { id: 'product-types', name: 'Типы товаров',  icon: 'tag',      kind: 'simple', group: 'system', createLabel: 'Создать запись', sheetKind: 'Тип товара' },
]
