import type { IconName } from '../components/Icon'

// Корневые вкладки. Набор зависит от роли (см. tabsForRole).
export type TabName =
  // склад (кладовщик / начсклада / начсмены)
  | 'tasks'
  | 'trips'
  | 'shipments'
  | 'stock'
  // начальник смены
  | 'packing'
  // менеджер
  | 'mTrips'
  | 'mWarehouse'
  | 'mReceipts'
  | 'mPacking'
  | 'mDispatch'

export type TabDef = { name: TabName; label: string; icon: IconName }

const WAREHOUSE_TABS: TabDef[] = [
  { name: 'tasks', label: 'Задачи', icon: 'list' },
  { name: 'trips', label: 'Рейсы', icon: 'truck' },
  { name: 'shipments', label: 'Отгрузки', icon: 'box' },
  { name: 'stock', label: 'Остатки', icon: 'layers' },
]

// Менеджерский бар повторяет складскую раскладку (4 вкладки + скан-FAB по центру):
// задачи и рейсы слева, склад-хаб и остатки справа. Документские потоки
// (поступления/упаковка/отгрузки) спрятаны внутрь хаба «Склад».
const MANAGER_TABS: TabDef[] = [
  { name: 'tasks', label: 'Задачи', icon: 'list' },
  { name: 'mTrips', label: 'Рейсы', icon: 'truck' },
  { name: 'mWarehouse', label: 'Склад', icon: 'boxes' },
  { name: 'stock', label: 'Остатки', icon: 'layers' },
]

// Начальник смены: только его участок процесса — задачи и упаковка (QC годный/брак).
// Скан-FAB по центру, две вкладки по бокам.
const SHIFT_LEAD_TABS: TabDef[] = [
  { name: 'tasks', label: 'Мои задачи', icon: 'list' },
  { name: 'packing', label: 'Упаковка', icon: 'box' },
]

// Начальник склада: раскладка повторяет менеджерскую (задачи / рейсы / хаб «Склад» /
// остатки), но без права создавать документы — хаб ведёт к спискам и деталкам в режиме
// просмотра, а операции (приёмка в рейсе, приёмка упаковки, подготовка отгрузки) идут
// через «Задачи» и «Рейсы». Поэтому вкладка «Рейсы» — рабочая (trips), а не менеджерская
// заглушка (mTrips): начсклада физически работает с рейсами.
const WAREHOUSE_HEAD_TABS: TabDef[] = [
  { name: 'tasks', label: 'Задачи', icon: 'list' },
  { name: 'trips', label: 'Рейсы', icon: 'truck' },
  { name: 'mWarehouse', label: 'Склад', icon: 'boxes' },
  { name: 'stock', label: 'Остатки', icon: 'layers' },
]

// Менеджерский интерфейс (создание документов) — у ролей с правом создавать
// (admin/manager, ср. web canCreateDocuments). Складские роли видят интерфейс кладовщика.
const MANAGER_ROLES = new Set(['manager', 'admin'])
const SHIFT_LEAD_ROLES = new Set(['shift_supervisor'])
const WAREHOUSE_HEAD_ROLES = new Set(['warehouse_head'])

export function tabsForRole(role: string): TabDef[] {
  if (MANAGER_ROLES.has(role)) return MANAGER_TABS
  if (SHIFT_LEAD_ROLES.has(role)) return SHIFT_LEAD_TABS
  if (WAREHOUSE_HEAD_ROLES.has(role)) return WAREHOUSE_HEAD_TABS
  return WAREHOUSE_TABS
}

// Скан-FAB по центру таб-бара — у всех ролей (сканер ШК/мест).
export function showScanForRole(_role: string): boolean {
  return true
}
