// TODO: заменить на реальные данные через GET /api/activity?limit=20

import type { IconName } from '../../primitives/Icon'

export type ActivityTone = 'accent' | 'success' | 'warning' | ''

export interface ActivityEvent {
  kind: string
  icon: IconName
  text: string
  meta: string
  time: string
  tone: ActivityTone
}

export const ACTIVITY_EVENTS: ActivityEvent[] = [
  { kind: 'receipt',  icon: 'truckIn',  text: 'Принято поступление RCP-0421',    meta: 'Mango Republic · 488 шт',                        time: '14:32', tone: 'accent'  },
  { kind: 'shipment', icon: 'truckOut', text: 'Отгружено SHP-1207',               meta: 'Lukomorye OOO → Ozon Хоругвино',                  time: '12:30', tone: 'success' },
  { kind: 'defect',   icon: 'alert',    text: 'Зафиксирован брак DEF-244',        meta: 'MNG-TS-01 · 2 шт · Брак шва',                     time: '14:48', tone: 'warning' },
  { kind: 'user',     icon: 'user',     text: 'Анна Сорокина изменила роль',       meta: 'sergey@pack-men.ru: operator → manager',           time: '11:02', tone: ''        },
  { kind: 'dict',     icon: 'plus',     text: 'Создан размер 44',                  meta: 'Справочник «Размеры»',                              time: 'вчера', tone: ''        },
]
