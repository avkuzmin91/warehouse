import { ListPage } from '../layouts/ListPage'
import { EmptyState } from '../primitives/EmptyState'

export function AnalyticsPage() {
  return (
    <ListPage title="Аналитика" subtitle="Раздел временно отключен">
      <EmptyState
        title="Аналитика недоступна"
        sub="Отчеты и графики отключены. Основные складские операции остаются доступны в разделах поступлений, отгрузок и остатков."
      />
    </ListPage>
  )
}
