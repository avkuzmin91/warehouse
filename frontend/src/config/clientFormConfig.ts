/** ТЗ: Client Form — подписи, плейсхолдеры, тексты валидации и ошибок API */

export const CLIENT_FORM_CONFIG = {
  name: {
    label: 'Название клиента',
    placeholder: 'Введите название клиента',
  },
  isActive: {
    label: 'Актуален',
  },
  messages: {
    requiredFields: 'Заполните обязательные поля',
    notFound: 'Клиент не найден',
    duplicateClient: 'Клиент уже существует',
    saveFailed: 'Ошибка сохранения',
    loadFailed: 'Ошибка загрузки',
  },
} as const

/** ТЗ п. 5.4: «Клиент уже существует» и сохранение полей формы */
export function mapClientFormApiError(message: string): string {
  if (message.includes('уже существ') || message.includes('названием')) {
    return CLIENT_FORM_CONFIG.messages.duplicateClient
  }
  return message
}
