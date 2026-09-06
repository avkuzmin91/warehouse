export type BreadcrumbItem = { label: string; to: string | null }

type CrumbDef = { label: string; to?: string }

const INVENTORY: CrumbDef = { label: 'Склад', to: '/inventory' }
const PACKING: CrumbDef = { label: 'Упаковка', to: '/inventory/packing' }
const LOGISTICS: CrumbDef = { label: 'Логистика' }
const FINANCE: CrumbDef = { label: 'Финансы' }
const TIMESHEET: CrumbDef = { label: 'Табель', to: '/timesheet' }
const MARKETPLACES: CrumbDef = { label: 'Маркетплейсы' }
const DICTIONARIES: CrumbDef = { label: 'Справочники', to: '/dictionaries' }
const CABINET: CrumbDef = { label: 'Личный кабинет', to: '/cabinet' }

const DICT_ENTITIES: Array<[slug: string, list: string, create: string, card: string]> = [
  ['clients', 'Клиенты', 'Новый клиент', 'Карточка клиента'],
  ['sizes', 'Размеры', 'Новый размер', 'Карточка размера'],
  ['colors', 'Цвета', 'Новый цвет', 'Карточка цвета'],
  ['product-types', 'Типы товаров', 'Новый тип товара', 'Карточка типа товара'],
  ['suppliers', 'Поставщики', 'Новый поставщик', 'Карточка поставщика'],
  ['products', 'Товары', 'Новый товар', 'Карточка товара'],
]

const ROUTES: Array<[pattern: string, crumbs: CrumbDef[]]> = [
  ['/home', [{ label: 'Главная' }]],
  ['/access-denied', [{ label: 'Нет доступа' }]],
  ['/account/password', [{ label: 'Аккаунт' }, { label: 'Смена пароля' }]],
  ['/analytics', [{ label: 'Аналитика' }]],

  ['/inventory', [INVENTORY]],
  ['/inventory/balances', [INVENTORY, { label: 'Остатки' }]],
  ['/inventory/receipts', [INVENTORY, { label: 'Поступления' }]],
  ['/inventory/receipts/new', [INVENTORY, { label: 'Поступления', to: '/inventory/receipts' }, { label: 'Новое поступление' }]],
  ['/inventory/receipts/:docId', [INVENTORY, { label: 'Поступления', to: '/inventory/receipts' }, { label: 'Карточка поступления' }]],
  ['/inventory/boxes', [INVENTORY, { label: 'Развозка по местам' }]],
  ['/inventory/boxes/:boxId', [INVENTORY, { label: 'Карточка короба' }]],
  ['/inventory/packing', [INVENTORY, { label: 'Упаковка' }]],
  ['/inventory/packing/productivity', [INVENTORY, PACKING, { label: 'Производительность' }]],
  // Под /inventory/shipments живут две задачи — упаковка и размещение по ячейкам,
  // поэтому последняя крошка нейтральна: тип задачи виден в её шапке.
  ['/inventory/shipments/new', [INVENTORY, PACKING, { label: 'Новая задача склада' }]],
  ['/inventory/shipments/:docId', [INVENTORY, PACKING, { label: 'Карточка задачи склада' }]],
  ['/inventory/dispatches', [INVENTORY, { label: 'Отгрузки' }]],
  ['/inventory/dispatches/new', [INVENTORY, { label: 'Отгрузки', to: '/inventory/dispatches' }, { label: 'Новая отгрузка' }]],
  ['/inventory/dispatches/:docId', [INVENTORY, { label: 'Отгрузки', to: '/inventory/dispatches' }, { label: 'Карточка отгрузки' }]],

  ['/logistics/trips', [LOGISTICS, { label: 'Рейсы' }]],
  ['/logistics/trips/new', [LOGISTICS, { label: 'Рейсы', to: '/logistics/trips' }, { label: 'Новый рейс' }]],
  ['/logistics/trips/:tripId', [LOGISTICS, { label: 'Рейсы', to: '/logistics/trips' }, { label: 'Карточка рейса' }]],
  ['/logistics/kit', [LOGISTICS, { label: 'UI-кит' }]],

  ['/timesheet', [{ label: 'Табель' }]],
  ['/timesheet/planning', [TIMESHEET, { label: 'Планирование' }]],
  ['/timesheet/payroll', [TIMESHEET, { label: 'Выплаты' }]],
  ['/timesheet/employees', [TIMESHEET, { label: 'Сотрудники' }]],
  ['/timesheet/employees/:empId', [TIMESHEET, { label: 'Сотрудники', to: '/timesheet/employees' }, { label: 'Карточка сотрудника' }]],
  ['/timesheet/calendar', [TIMESHEET, { label: 'Производственный календарь' }]],

  ['/finance/invoices', [FINANCE, { label: 'Счета' }]],
  ['/finance/invoices/new', [FINANCE, { label: 'Счета', to: '/finance/invoices' }, { label: 'Новый счёт' }]],
  ['/finance/invoices/:invoiceId', [FINANCE, { label: 'Счета', to: '/finance/invoices' }, { label: 'Карточка счёта' }]],
  ['/finance/uninvoiced', [FINANCE, { label: 'Отгрузки без счёта' }]],
  ['/finance/expenses', [FINANCE, { label: 'Расходы' }]],
  ['/finance/extra-income', [FINANCE, { label: 'Доп. работы' }]],
  ['/finance/recurring', [FINANCE, { label: 'Регулярные расходы' }]],
  ['/finance/storage', [FINANCE, { label: 'Хранение' }]],

  ['/marketplaces/supplies', [MARKETPLACES, { label: 'Отгрузки FBS' }]],
  ['/marketplaces/supplies/new', [MARKETPLACES, { label: 'Отгрузки FBS', to: '/marketplaces/supplies' }, { label: 'Новая поставка' }]],
  ['/marketplaces/supplies/:supplyId', [MARKETPLACES, { label: 'Отгрузки FBS', to: '/marketplaces/supplies' }, { label: 'Поставка' }]],
  ['/marketplaces/orders', [MARKETPLACES, { label: 'FBS-заказы' }]],
  ['/marketplaces/orders/:orderId', [MARKETPLACES, { label: 'FBS-заказы', to: '/marketplaces/orders' }, { label: 'Карточка заказа' }]],
  ['/marketplaces/links', [MARKETPLACES, { label: 'Связка товаров' }]],
  ['/marketplaces/accounts', [MARKETPLACES, { label: 'Подключения' }]],

  ['/dictionaries', [{ label: 'Справочники' }]],
  ['/dictionaries/users', [{ label: 'Управление' }, { label: 'Пользователи' }]],
  ...DICT_ENTITIES.flatMap(([slug, list, create, card]): Array<[string, CrumbDef[]]> => {
    const listCrumb: CrumbDef = { label: list, to: `/dictionaries?type=${slug}` }
    return [
      [`/dictionaries/${slug}/new`, [DICTIONARIES, listCrumb, { label: create }]],
      [`/dictionaries/${slug}/:id`, [DICTIONARIES, listCrumb, { label: card }]],
    ]
  }),
  ['/dictionaries/products/:id/edit', [
    DICTIONARIES,
    { label: 'Товары', to: '/dictionaries?type=products' },
    { label: 'Карточка товара', to: '/dictionaries/products/:id' },
    { label: 'Редактирование' },
  ]],

  ['/cabinet', [{ label: 'Личный кабинет' }]],
  ['/cabinet/balances', [CABINET, { label: 'Остатки' }]],
  ['/cabinet/receipts', [CABINET, { label: 'Поступления' }]],
  ['/cabinet/receipts/:docId', [CABINET, { label: 'Поступления', to: '/cabinet/receipts' }, { label: 'Карточка поступления' }]],
  ['/cabinet/shipments', [CABINET, { label: 'Отгрузки' }]],
  ['/cabinet/shipments/:docId', [CABINET, { label: 'Отгрузки', to: '/cabinet/shipments' }, { label: 'Карточка отгрузки' }]],
  ['/cabinet/defects', [CABINET, { label: 'Брак' }]],
  ['/cabinet/products', [CABINET, { label: 'Мои товары' }]],
  ['/cabinet/products/:id', [CABINET, { label: 'Мои товары', to: '/cabinet/products' }, { label: 'Карточка товара' }]],
  ['/cabinet/reports', [CABINET, { label: 'Отчёты' }]],
  ['/cabinet/profile', [CABINET, { label: 'Профиль и магазины' }]],
]

/**
 * Последний пункт всегда с `to: null` (текущая страница).
 * Неизвестный путь — пустой массив, Topbar крошки не рисует.
 */
export function buildBreadcrumbsFromPathname(pathname: string): BreadcrumbItem[] {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const parts = normalized.split('/').filter(Boolean)

  for (const [pattern, defs] of ROUTES) {
    const patternParts = pattern.split('/').filter(Boolean)
    if (patternParts.length !== parts.length) continue

    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < patternParts.length; i += 1) {
      const pp = patternParts[i]
      if (pp.startsWith(':')) {
        params[pp] = parts[i]
      } else if (pp !== parts[i]) {
        matched = false
        break
      }
    }
    if (!matched) continue

    return defs.map((d, i) => ({
      label: d.label,
      to:
        i === defs.length - 1 || !d.to
          ? null
          : d.to.replace(/:[^/?]+/g, (m) => params[m] ?? m),
    }))
  }
  return []
}
