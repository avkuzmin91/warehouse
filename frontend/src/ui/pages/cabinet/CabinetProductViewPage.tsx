import { DetailPage } from '../../layouts/DetailPage'
import { EmptyState } from '../../primitives/EmptyState'

export function CabinetProductViewPage() {
  return (
    <DetailPage title="Товар клиента" subtitle="Раздел временно отключен" backTo="/cabinet/products">
      <EmptyState
        title="Карточка товара в личном кабинете недоступна"
        sub="Клиентский портал отключен. Просмотр и управление товарами доступны в основном справочнике."
      />
    </DetailPage>
  )
}
