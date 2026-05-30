import { useFilterParam } from '../../../../hooks/useFilterParams'
import { ByProductView } from './views/ByProductView'
import { ByZoneView } from './views/ByZoneView'

export function BalancesFeature() {
  const [view, setView] = useFilterParam('view', 'product')

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Остатки</div>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${view !== 'zone' ? 'active' : ''}`} onClick={() => setView('product')}>
          По товарам
        </button>
        <button className={`tab ${view === 'zone' ? 'active' : ''}`} onClick={() => setView('zone')}>
          По месту хранения
        </button>
      </div>

      {view === 'zone' ? <ByZoneView /> : <ByProductView />}
    </div>
  )
}
