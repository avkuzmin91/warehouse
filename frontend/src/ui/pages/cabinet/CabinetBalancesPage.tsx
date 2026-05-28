import { ListPage } from '../../layouts/ListPage'
import { EmptyState } from '../../primitives/EmptyState'

export function CabinetBalancesPage() {
  return (
    <ListPage title="Остатки клиента" subtitle="Раздел временно отключен">
      <EmptyState
        title="Остатки в личном кабинете недоступны"
        sub="Клиентский портал отключен. Используйте основной раздел складских остатков."
      />
    </ListPage>
  )
}
