import type { User } from '../api/typesUser'

export function canViewCosts(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canEditPlannedArrival(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canManageUsers(user: User | null | undefined): boolean {
  return user?.role === 'admin'
}

// Справочник «Наши склады» (ставки аренды) — только админ.
export function canManageOwnWarehouses(user: User | null | undefined): boolean {
  return user?.role === 'admin'
}

// Расходы-«фиксы» (аренда склада, ЗП) и сводный реестр всех типов — только админ.
// Менеджер видит и заводит только хозрасходы и логистику.
export function canManageAdminFinance(user: User | null | undefined): boolean {
  return user?.role === 'admin'
}

export function canEditShipmentFiles(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canEditShipmentPriority(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canEditShipmentPlanning(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

export function canEditShipments(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
}

// Отметка «Отгрузка подготовлена» (preparing → awaiting_trip) — задача кладовщика,
// плюс менеджерский состав может закрыть её сам.
export function canPrepareDispatch(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager' || user?.role === 'warehouse_head'
}

export function canCreateDocuments(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}

// Пост-фактум корректировка обсчёта приёмки (правит остатки) — менеджер и начальник склада.
export function canCorrectReceived(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_head'
}

export function canPackShipments(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'shift_supervisor' || user?.role === 'warehouse_head'
}

// Табель: план/факт ведёт начальник смены (+ начальник склада) и менеджерский состав.
export function canManageTimesheet(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'shift_supervisor' || user?.role === 'warehouse_head'
}

// Деньги табеля (ставки, заработок, выплаты) — только менеджер и админ.
export function canViewPayroll(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager'
}
