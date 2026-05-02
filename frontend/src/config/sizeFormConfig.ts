/** Поля формы размера (без code). */

export const SIZE_FORM_CONFIG = {
  name: {
    label: 'Название размера',
    placeholder: 'Введите название размера',
  },
  isActive: {
    label: 'Актуален',
  },
  messages: {
    requiredFields: 'Заполните обязательные поля',
    notFound: 'Размер не найден',
    saveFailed: 'Ошибка сохранения',
    loadFailed: 'Ошибка загрузки',
  },
} as const
