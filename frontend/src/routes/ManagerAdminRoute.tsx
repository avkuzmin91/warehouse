import type { ReactNode } from 'react'
import { RoleRestrictedRoute } from './RoleRestrictedRoute'

type ManagerAdminRouteProps = {
  children: ReactNode
}

export function ManagerAdminRoute({ children }: ManagerAdminRouteProps) {
  return <RoleRestrictedRoute gate="manager_admin">{children}</RoleRestrictedRoute>
}
