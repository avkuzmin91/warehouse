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
  | 'vehicle-types'

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
  { id: 'unloading-zones', name: 'Места хранения',  icon: 'boxes',    kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Место хранения' },
  { id: 'warehouses',       name: 'Точки логистики',  icon: 'map',      kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Точка логистики' },
  { id: 'carriers',      name: 'Перевозчики',   icon: 'truckOut', kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Перевозчик' },
  { id: 'vehicle-types', name: 'Типы кузовов',   icon: 'truckOut', kind: 'simple', group: 'main',   createLabel: 'Создать запись', sheetKind: 'Тип кузова' },
  { id: 'product-types', name: 'Типы товаров',  icon: 'tag',      kind: 'simple', group: 'system', createLabel: 'Создать запись', sheetKind: 'Тип товара' },
]
