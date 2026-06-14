import { getCabinetProfile } from '../../../api/cabinetApi'
import { useApi } from '../../../hooks/useApi'
import { ListPage } from '../../layouts/ListPage'
import { Badge } from '../../primitives/Badge'
import { getInitials } from '../../primitives/Avatar'
import { EmptyState } from '../../primitives/EmptyState'
import { Icon } from '../../primitives/Icon'
import { Skeleton } from '../../primitives/Skeleton'

/** Инициалы компании без правовой формы и кавычек («ООО „Лана Стиль"» → «ЛС»). */
function companyInitials(name: string): string {
  const cleaned = name
    .replace(/[«»"„“]/g, ' ')
    .replace(/\b(ООО|ИП|АО|ЗАО|ПАО|ОАО)\b/gi, ' ')
    .trim()
  return cleaned ? getInitials(cleaned) : getInitials(name)
}

export function CabinetProfileFeature() {
  const { data, loading, error } = useApi((signal) => getCabinetProfile(signal), [])

  if (error) {
    return (
      <ListPage title="Профиль и магазины">
        <EmptyState title="Не удалось загрузить профиль" sub={error.message} />
      </ListPage>
    )
  }

  const stores = data?.stores ?? []
  const activeCount = stores.filter((s) => s.is_active).length

  return (
    <ListPage
      title="Профиль и магазины"
      subtitle="Данные вашей компании и список магазинов для отгрузок"
    >
      <div className="profile-band" style={{ marginBottom: 20 }}>
        <div className="profile-logo">{data ? companyInitials(data.client.name) : ''}</div>
        <div style={{ flex: 1 }}>
          <div className="t-sub">Клиент</div>
          {loading ? (
            <Skeleton height={20} width={220} />
          ) : (
            <div style={{ fontWeight: 650, fontSize: 18, letterSpacing: '-0.01em' }}>{data?.client.name}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="t-sub">Магазинов подключено</div>
          <div style={{ fontWeight: 650, fontSize: 18 }}>
            {activeCount}{' '}
            <span className="t-sub" style={{ fontWeight: 450 }}>из {stores.length}</span>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h3 className="row gap-8"><Icon name="cart" size={15} className="ic-accent" />Магазины</h3>
        <span className="t-sub">чтобы добавить магазин — обратитесь к менеджеру</span>
      </div>
      {loading ? (
        <div className="stgrid">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="stcard"><Skeleton height={38} /></div>
          ))}
        </div>
      ) : stores.length === 0 ? (
        <EmptyState
          title="Магазинов нет"
          sub="Чтобы добавить магазины для отгрузок, обратитесь к вашему менеджеру"
        />
      ) : (
        <div className="stgrid">
          {stores.map((store) => (
            <div key={store.id} className={`stcard${store.is_active ? '' : ' off'}`}>
              <div className="stcard-ico"><Icon name="cart" size={17} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 550 }}>{store.name}</div>
                <div className="t-sub">точка отгрузки</div>
              </div>
              <Badge tone={store.is_active ? 'success' : ''} dot>
                {store.is_active ? 'Активен' : 'Неактивен'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </ListPage>
  )
}
