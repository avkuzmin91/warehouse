import type { InventoryOpType } from '../../../api/domainTypes'
import { ListPage } from '../../layouts/ListPage'
import { EmptyState } from '../../primitives/EmptyState'

interface Props {
  opType: InventoryOpType
}

export function CabinetOperationsPage({ opType }: Props) {
  const title = opType === 'in' ? 'Поступления клиента' : 'Отгрузки клиента'

  return (
    <ListPage title={title} subtitle="Раздел временно отключен">
      <EmptyState
        title="Операции в личном кабинете недоступны"
        sub="Клиентский портал отключен. Поступления и отгрузки доступны в основных складских разделах."
      />
    </ListPage>
  )
}
