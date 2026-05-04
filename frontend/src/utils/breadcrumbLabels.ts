/**
 * Правила ТЗ: «# Хлебные крошки» — маппинг сегментов, динамика: id → «Карточка», new/edit.
 */

export type BreadcrumbItem = { label: string; to: string | null }

const STATIC: Record<string, string> = {
  home: 'Главная',
  dictionaries: 'Справочники',
  products: 'Товары',
  users: 'Пользователи',
  inventory: 'Учет товаров',
  analytics: 'Аналитика',
  cabinet: 'Личный кабинет',
  receipt: 'Приёмка товаров',
  receipts: 'Поступления',
  shipments: 'Отгрузки',
  balances: 'Остатки',
  clients: 'Клиенты',
  colors: 'Цвета',
  sizes: 'Размеры',
  suppliers: 'Поставщики',
  'product-types': 'Типы товаров',
}

const DICT_SECTIONS = new Set(['clients', 'colors', 'products', 'product-types', 'suppliers'])

const CREATE_BY_PREV: Record<string, string> = {
  clients: 'Создание клиента',
  colors: 'Создание цвета',
  sizes: 'Создание размера',
  products: 'Создание товара',
  suppliers: 'Создание поставщика',
  'product-types': 'Создание типа товара',
  receipts: 'Новое поступление',
  shipments: 'Новая отгрузка',
}

function labelForSegment(segment: string, index: number, parts: string[]): string {
  if (segment === 'edit') {
    return 'Редактирование'
  }
  if (
    parts[0] === 'dictionaries' &&
    parts[1] === 'products' &&
    index === 2 &&
    index === parts.length - 1
  ) {
    const s = parts[2] ?? ''
    if (s !== 'new' && s !== 'edit' && s.length > 0) {
      return 'Редактирование товара'
    }
  }
  if (
    parts[0] === 'dictionaries' &&
    parts[1] === 'clients' &&
    index === 2 &&
    index === parts.length - 1
  ) {
    const s = parts[2] ?? ''
    if (s !== 'new' && s !== 'edit' && s.length > 0) {
      return 'Редактирование клиента'
    }
  }
  if (
    parts[0] === 'dictionaries' &&
    parts[1] === 'sizes' &&
    index === 2 &&
    index === parts.length - 1
  ) {
    const s = parts[2] ?? ''
    if (s !== 'new' && s.length > 0) {
      return 'Редактирование размера'
    }
  }
  if (
    parts[0] === 'dictionaries' &&
    parts[1] === 'colors' &&
    index === 2 &&
    index === parts.length - 1
  ) {
    const s = parts[2] ?? ''
    if (s !== 'new' && s.length > 0) {
      return 'Редактирование цвета'
    }
  }
  if (
    parts[0] === 'dictionaries' &&
    parts[1] === 'product-types' &&
    index === 2 &&
    index === parts.length - 1
  ) {
    const s = parts[2] ?? ''
    if (s !== 'new' && s.length > 0) {
      return 'Редактирование типа товара'
    }
  }
  if (
    parts[0] === 'dictionaries' &&
    parts[1] === 'suppliers' &&
    index === 2 &&
    index === parts.length - 1
  ) {
    const s = parts[2] ?? ''
    if (s !== 'new' && s.length > 0) {
      return 'Редактирование поставщика'
    }
  }
  if (
    parts[0] === 'inventory' &&
    parts[1] === 'receipts' &&
    index === 2 &&
    index === parts.length - 1
  ) {
    const s = parts[2] ?? ''
    if (s !== 'new' && s.length > 0) {
      return 'Редактирование поступления'
    }
  }
  if (segment === 'new') {
    const prev = index > 0 ? parts[index - 1] : null
    if (prev && CREATE_BY_PREV[prev]) {
      return CREATE_BY_PREV[prev]
    }
    return 'Создание'
  }
  if (STATIC[segment]) {
    return STATIC[segment]
  }
  if (index >= 2 && parts[0] === 'dictionaries' && DICT_SECTIONS.has(parts[1] ?? '')) {
    return 'Карточка'
  }
  return segment
}

/**
 * Последний пункт с `to: null` (текущая страница).
 */
export function buildBreadcrumbsFromPathname(pathname: string): BreadcrumbItem[] {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const parts = normalized.split('/').filter(Boolean)

  if (parts.length === 0) {
    return []
  }
  if (parts.length === 1 && parts[0] === 'home') {
    return [{ label: 'Главная', to: null }]
  }
  if (parts.length === 1 && parts[0] === 'cabinet') {
    return [
      { label: 'Главная', to: '/home' },
      { label: 'Личный кабинет', to: null },
    ]
  }

  const items: BreadcrumbItem[] = [{ label: 'Главная', to: '/home' }]

  for (let i = 0; i < parts.length; i += 1) {
    const path = `/${parts.slice(0, i + 1).join('/')}`
    const seg = parts[i]
    const isLast = i === parts.length - 1
    const label = labelForSegment(seg, i, parts)
    items.push({
      label,
      to: isLast ? null : path,
    })
  }
  return items
}
