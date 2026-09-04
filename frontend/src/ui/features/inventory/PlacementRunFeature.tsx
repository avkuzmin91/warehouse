import { useNavigate } from 'react-router-dom'
import { ListPage } from '../../layouts/ListPage'
import { Icon } from '../../primitives/Icon'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { canManageBoxSupply } from '../../../utils/access'
import { PendingPlacementPanel } from './PendingPlacementPanel'

/** «Развозка по местам»: что стоит у стола и куда это увезли.
 *
 * Экран одной работы — ходки тележки. Реестра коробов здесь нет: статусы, поиск и
 * заведение живут в справочнике «Короба», иначе получается два списка одного и того же.
 * Вход сюда — карточка «Развезти по местам» в «Моих задачах»; обычно эту работу
 * ведут сканером на ТСД, а web — путь, когда ТСД недоступен.
 */
export function PlacementRunFeature() {
  const navigate = useNavigate()
  const { user } = useCurrentUser()

  return (
    <ListPage
      title="Развозка по местам"
      subtitle="закрытые короба и собранное без короба ждут, когда их увезут в места хранения"
      actions={
        canManageBoxSupply(user) ? (
          <button className="btn" onClick={() => navigate('/dictionaries?type=boxes')}>
            <Icon name="archive" size={14} />Реестр коробов
          </button>
        ) : null
      }
    >
      <PendingPlacementPanel showEmpty onPlaced={() => {}} />
    </ListPage>
  )
}
