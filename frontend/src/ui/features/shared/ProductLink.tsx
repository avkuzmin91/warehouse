import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useCurrentUser } from '../../../hooks/useCurrentUser'

// Карточка товара на backend требует backoffice-роль (shift_supervisor остатки видит,
// а карточку — нет), поэтому для остальных ролей рендерим обычный текст без ссылки.
const BACKOFFICE_ROLES = new Set(['admin', 'manager', 'warehouse_manager', 'warehouse_head'])

type Props = {
  productId: string | null | undefined
  children: ReactNode
}

export function ProductLink({ productId, children }: Props) {
  const { user } = useCurrentUser()
  const role = user?.role
  const to = !productId || !role
    ? null
    : role === 'client'
      ? `/cabinet/products/${productId}`
      : BACKOFFICE_ROLES.has(role)
        ? `/dictionaries/products/${productId}`
        : null
  if (!to) return <>{children}</>
  return (
    <Link
      to={to}
      className="cell-link"
      title="Открыть карточку товара"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </Link>
  )
}
