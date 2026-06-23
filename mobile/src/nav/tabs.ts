import type { IconName } from '../components/Icon'

// Корневые вкладки. Набор зависит от роли (см. tabsForRole).
export type TabName =
  // склад (кладовщик / начсклада / начсмены)
  | 'tasks'
  | 'trips'
  | 'shipments'
  | 'stock'
  // менеджер
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

const MANAGER_TABS: TabDef[] = [
  { name: 'mReceipts', label: 'Поступления', icon: 'truckIn' },
  { name: 'mPacking', label: 'Упаковка', icon: 'box' },
  { name: 'mDispatch', label: 'Отгрузки', icon: 'truckOut' },
]

// Менеджерский интерфейс (создание документов) — у ролей с правом создавать
// (admin/manager, ср. web canCreateDocuments). Складские роли видят интерфейс кладовщика.
const MANAGER_ROLES = new Set(['manager', 'admin'])

export function tabsForRole(role: string): TabDef[] {
  return MANAGER_ROLES.has(role) ? MANAGER_TABS : WAREHOUSE_TABS
}

// Скан-FAB по центру таб-бара — только у складских ролей (сканер ШК/мест).
export function showScanForRole(role: string): boolean {
  return !MANAGER_ROLES.has(role)
}
