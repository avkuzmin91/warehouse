export const OP_LABELS: Record<string, string> = {
  doc_create:      'Документ создан',
  doc_update:      'Документ изменён',
  priority_update: 'Приоритет изменён',
  line_add:        'Позиция добавлена',
  line_update:     'Позиция изменена',
  line_delete:     'Позиция удалена',
  advance:         'Передано в подготовку',
  prepare:         'Подготовка завершена',
  ship:            'Отгружено рейсом',
  cancel:          'Аннулирована',
  return_to_draft: 'Возврат на корректировку',
}

export const OP_ICONS: Record<string, string> = {
  doc_create:      'plus',
  doc_update:      'edit',
  priority_update: 'arrowUp',
  line_add:        'plus',
  line_update:     'edit',
  line_delete:     'trash',
  advance:         'arrowRight',
  prepare:         'check',
  ship:            'truckOut',
  cancel:          'x',
  return_to_draft: 'arrowLeft',
}

export const OP_TONES: Record<string, string> = {
  doc_create:      'accent',
  doc_update:      '',
  priority_update: '',
  line_add:        '',
  line_update:     '',
  line_delete:     'warning',
  advance:         '',
  prepare:         'success',
  ship:            'success',
  cancel:          'danger',
  return_to_draft: 'warning',
}
