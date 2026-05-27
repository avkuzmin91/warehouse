import { ListPage } from '../../layouts/ListPage'
import { EmptyState } from '../../primitives/EmptyState'

export function CabinetProductsPage() {
  return (
    <ListPage title="Товары клиента" subtitle="Раздел временно отключен">
      <EmptyState
        title="Каталог товаров в личном кабинете недоступен"
        sub="Клиентский портал отключен. Управление товарами остается в основном справочнике товаров."
      />
    </ListPage>
  )
}
