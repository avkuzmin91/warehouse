import { getCabinetProfile } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { Table, Td } from '../../data/Table'
import { ListPage } from '../../layouts/ListPage'
import { Badge } from '../../primitives/Badge'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { SkeletonRows } from '../../primitives/Skeleton'

export function CabinetProfileFeature() {
  const { data, loading, error } = useApi((signal) => getCabinetProfile(signal), [])

  if (error) {
    return (
      <ListPage title="Профиль и магазины">
        <EmptyState title="Не удалось загрузить профиль" sub={error.message} />
      </ListPage>
    )
  }

  return (
    <ListPage
      title="Профиль и магазины"
      subtitle="Данные вашей компании и список магазинов для отгрузок"
    >
      <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="building" size={22} className="ic-accent" />
        <div>
          <div className="t-sub">Клиент</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{loading ? 'Загрузка…' : data?.client.name}</div>
        </div>
      </div>

      <div className="card-head" style={{ marginBottom: 8 }}>
        <span className="card-head-title">Магазины</span>
        <div className="flex-1" />
        <span className="t-sub">{data?.stores.length ?? 0}</span>
      </div>
      <Table>
        <thead>
          <tr>
            <th>Название</th>
            <th style={{ width: 130 }}>Состояние</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <SkeletonRows rows={3} cols={2} />
          ) : (data?.stores ?? []).length === 0 ? (
            <tr>
              <Td colSpan={2}>
                <EmptyState
                  title="Магазинов нет"
                  sub="Чтобы добавить магазины для отгрузок, обратитесь к вашему менеджеру"
                />
              </Td>
            </tr>
          ) : (
            (data?.stores ?? []).map((store) => (
              <tr key={store.id}>
                <Td style={{ fontWeight: 500 }}>{store.name}</Td>
                <Td>
                  <Badge tone={store.is_active ? 'success' : ''} dot>
                    {store.is_active ? 'Активен' : 'Неактивен'}
                  </Badge>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </ListPage>
  )
}
