import { ListPage } from '../../layouts/ListPage'
import { EmptyState } from '../../primitives/EmptyState'

export function CabinetDashboardPage() {
  return (
    <ListPage title="Личный кабинет" subtitle="Раздел временно отключен">
      <EmptyState
        title="Личный кабинет недоступен"
        sub="Клиентский портал отключен. Доступ к складским операциям остается в основных разделах системы."
      />
    </ListPage>
  )
}
