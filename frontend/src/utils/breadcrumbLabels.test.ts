import { describe, expect, it } from 'vitest'
import { buildBreadcrumbsFromPathname } from './breadcrumbLabels'

describe('buildBreadcrumbsFromPathname', () => {
  it('простая страница: один пункт без ссылки', () => {
    expect(buildBreadcrumbsFromPathname('/home')).toEqual([{ label: 'Главная', to: null }])
  })

  it('списки: раздел кликабелен, текущая страница — нет', () => {
    expect(buildBreadcrumbsFromPathname('/inventory/receipts')).toEqual([
      { label: 'Склад', to: '/inventory' },
      { label: 'Поступления', to: null },
    ])
  })

  it('карточка документа: динамический сегмент → «Карточка …»', () => {
    expect(buildBreadcrumbsFromPathname('/inventory/dispatches/abc-123')).toEqual([
      { label: 'Склад', to: '/inventory' },
      { label: 'Отгрузки', to: '/inventory/dispatches' },
      { label: 'Карточка отгрузки', to: null },
    ])
  })

  it('раздел без собственной страницы не кликабелен', () => {
    expect(buildBreadcrumbsFromPathname('/finance/expenses')).toEqual([
      { label: 'Финансы', to: null },
      { label: 'Расходы', to: null },
    ])
  })

  it('упаковка: create/detail задач ведут на /inventory/packing', () => {
    expect(buildBreadcrumbsFromPathname('/inventory/shipments/xyz')).toEqual([
      { label: 'Склад', to: '/inventory' },
      { label: 'Упаковка', to: '/inventory/packing' },
      { label: 'Карточка задачи упаковки', to: null },
    ])
  })

  it('справочники: список сущности ссылается на /dictionaries?type=…', () => {
    expect(buildBreadcrumbsFromPathname('/dictionaries/clients/new')).toEqual([
      { label: 'Справочники', to: '/dictionaries' },
      { label: 'Клиенты', to: '/dictionaries?type=clients' },
      { label: 'Новый клиент', to: null },
    ])
  })

  it('редактирование товара: подставляет id в ссылку на карточку', () => {
    expect(buildBreadcrumbsFromPathname('/dictionaries/products/p-42/edit')).toEqual([
      { label: 'Справочники', to: '/dictionaries' },
      { label: 'Товары', to: '/dictionaries?type=products' },
      { label: 'Карточка товара', to: '/dictionaries/products/p-42' },
      { label: 'Редактирование', to: null },
    ])
  })

  it('личный кабинет: карточка поступления клиента', () => {
    expect(buildBreadcrumbsFromPathname('/cabinet/receipts/doc-1')).toEqual([
      { label: 'Личный кабинет', to: '/cabinet' },
      { label: 'Поступления', to: '/cabinet/receipts' },
      { label: 'Карточка поступления', to: null },
    ])
  })

  it('неизвестный путь и хвостовые слэши', () => {
    expect(buildBreadcrumbsFromPathname('/nope/nothing')).toEqual([])
    expect(buildBreadcrumbsFromPathname('/timesheet/')).toEqual([{ label: 'Табель', to: null }])
  })
})
