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
