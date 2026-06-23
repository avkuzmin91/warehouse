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
  { name: 'trips', label: 'Рейсы', icon: 'truckIn' },
  { name: 'shipments', label: 'Отгрузки', icon: 'box' },
  { name: 'stock', label: 'Остатки', icon: 'layers' },
]

const MANAGER_TABS: TabDef[] = [
  { name: 'mReceipts', label: 'Поступления', icon: 'truckIn' },
  { name: 'mPacking', label: 'Упаковка', icon: 'box' },
  { name: 'mDispatch', label: 'Отгрузки', icon: 'truckOut' },
]

export function tabsForRole(role: string): TabDef[] {
  return role === 'manager' ? MANAGER_TABS : WAREHOUSE_TABS
}

// Скан-FAB по центру таб-бара — только у складских ролей (сканер ШК/мест).
export function showScanForRole(role: string): boolean {
  return role !== 'manager'
}
