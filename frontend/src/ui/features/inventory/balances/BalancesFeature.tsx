import { useState } from 'react'
import { useFilterParam } from '../../../../hooks/useFilterParams'
import { useCurrentUser } from '../../../../hooks/useCurrentUser'
import { Icon } from '../../../primitives/Icon'
import { ByProductView } from './views/ByProductView'
import { ByZoneView } from './views/ByZoneView'
import { RelocationsView } from './views/RelocationsView'
import { StockEntryDrawer } from './StockEntryDrawer'

export function BalancesFeature() {
  const [view, setView] = useFilterParam('view', 'product')
  const { user } = useCurrentUser()
  const canManage = user?.role === 'admin' || user?.role === 'manager'
  const [entryOpen, setEntryOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Остатки</div>
        </div>
        {canManage && (
          <div className="page-actions">
            <button className="btn primary" onClick={() => setEntryOpen(true)}>
              <Icon name="plus" size={14} />Завести остаток
            </button>
          </div>
        )}
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

      {view === 'zone'
        ? <ByZoneView key={reloadKey} />
        : view === 'relocations'
          ? <RelocationsView key={reloadKey} />
          : <ByProductView key={reloadKey} />}

      <StockEntryDrawer
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        onDone={() => { setEntryOpen(false); setReloadKey((k) => k + 1) }}
      />
    </div>
  )
}
