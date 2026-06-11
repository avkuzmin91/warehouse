import { useFilterParam } from '../../../../hooks/useFilterParams'
import { ByProductView } from './views/ByProductView'
import { ByZoneView } from './views/ByZoneView'
import { RelocationsView } from './views/RelocationsView'

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
        <button className={`tab ${view === 'product' ? 'active' : ''}`} onClick={() => setView('product')}>
          По товарам
        </button>
        <button className={`tab ${view === 'zone' ? 'active' : ''}`} onClick={() => setView('zone')}>
          По местоположению
        </button>
        <button className={`tab ${view === 'relocations' ? 'active' : ''}`} onClick={() => setView('relocations')}>
          Перемещения
        </button>
      </div>

      {view === 'zone' ? <ByZoneView /> : view === 'relocations' ? <RelocationsView /> : <ByProductView />}
    </div>
  )
}
