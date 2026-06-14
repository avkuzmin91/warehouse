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
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'warehouse_manager'
}

export function canPackShipments(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager' || user?.role === 'shift_supervisor'
}
