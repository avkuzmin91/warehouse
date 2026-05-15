import type { ReactNode } from 'react'
import { RoleRestrictedRoute } from './RoleRestrictedRoute'

type AdminRouteProps = {
  children: ReactNode
}

export function AdminRoute({ children }: AdminRouteProps) {
  return <RoleRestrictedRoute gate="admin">{children}</RoleRestrictedRoute>
}
