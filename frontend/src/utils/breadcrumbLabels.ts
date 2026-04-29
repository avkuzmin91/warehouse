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
  clients: 'Клиенты',
  colors: 'Цвета',
  sizes: 'Размеры',
}

const DICT_SECTIONS = new Set(['clients', 'colors', 'sizes', 'products'])

const CREATE_BY_PREV: Record<string, string> = {
  clients: 'Создание клиента',
  colors: 'Создание цвета',
  sizes: 'Создание размера',
  products: 'Создание товара',
}

function labelForSegment(segment: string, index: number, parts: string[]): string {
  if (segment === 'edit') {
    return 'Редактирование'
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
