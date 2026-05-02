/** Универсальный паттерн простых справочников (name + is_active), см. ТЗ «Простые справочники». */

export const SIMPLE_DICTIONARY_KEYS = ['colors', 'product-types', 'suppliers'] as const

export type SimpleDictionaryEntityKey = (typeof SIMPLE_DICTIONARY_KEYS)[number]

export type SimpleDictionaryDefinition = {
  routeSegment: string
  apiPath: string
  listNameQueryKey: 'name' | 'search'
  title: string
  formNameLabel: string
  formNamePlaceholder: string
  messages: {
    requiredFields: string
    notFound: string
    saveFailed: string
    loadFailed: string
  }
}

export const SIMPLE_DICTIONARIES: Record<SimpleDictionaryEntityKey, SimpleDictionaryDefinition> = {
  colors: {
    routeSegment: 'colors',
    apiPath: '/colors',
    listNameQueryKey: 'name',
    title: 'Цвета',
    formNameLabel: 'Название цвета',
    formNamePlaceholder: 'Введите название цвета',
    messages: {
      requiredFields: 'Заполните обязательные поля',
      notFound: 'Цвет не найден',
      saveFailed: 'Ошибка сохранения',
      loadFailed: 'Ошибка загрузки',
    },
  },
  'product-types': {
    routeSegment: 'product-types',
    apiPath: '/product-types',
    listNameQueryKey: 'name',
    title: 'Типы товаров',
    formNameLabel: 'Наименование',
    formNamePlaceholder: 'Введите наименование типа',
    messages: {
      requiredFields: 'Заполните обязательные поля',
      notFound: 'Тип товара не найден',
      saveFailed: 'Ошибка сохранения',
      loadFailed: 'Ошибка загрузки',
    },
  },
  suppliers: {
    routeSegment: 'suppliers',
    apiPath: '/suppliers',
    listNameQueryKey: 'name',
    title: 'Поставщики',
    formNameLabel: 'Наименование',
    formNamePlaceholder: 'Введите наименование поставщика',
    messages: {
      requiredFields: 'Заполните обязательные поля',
      notFound: 'Поставщик не найден',
      saveFailed: 'Ошибка сохранения',
      loadFailed: 'Ошибка загрузки',
    },
  },
}

export function simpleDictionaryDefinition(entity: SimpleDictionaryEntityKey): SimpleDictionaryDefinition {
  return SIMPLE_DICTIONARIES[entity]
}
