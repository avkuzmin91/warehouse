import { useNav } from '../../nav/NavContext'
import { useAuth } from '../../auth/AuthContext'
import { AppBar } from '../../components/AppBar'
import { Icon, type IconName } from '../../components/Icon'
import { canCreateDocuments } from '../../utils/access'

type HubEntry = { label: string; sub: string; icon: IconName; open: () => void }

export function WarehouseHubScreen() {
  const { openReceiptsList, openPackingList, openDispatchList } = useNav()
  const { user } = useAuth()
  // Начальник склада видит хаб в режиме просмотра: создание документов — у менеджера.
  const viewOnly = !canCreateDocuments(user?.role)

  const entries: HubEntry[] = [
    { label: 'Поступления', sub: 'Документы приёмки', icon: 'dolly', open: openReceiptsList },
    { label: 'Упаковка', sub: 'Задачи упаковки', icon: 'box', open: openPackingList },
    { label: 'Отгрузки', sub: 'Документы отгрузки', icon: 'forklift', open: openDispatchList },
  ]

  return (
    <div className="screen">
      <AppBar title="Склад" sub="Документы" />
      <div className="scroll pad-nav">
        {viewOnly && (
          <div className="sec">Документы склада<span className="sec-count">просмотр</span></div>
        )}
        {entries.map((e) => (
          <button key={e.label} className="tile" onClick={e.open}>
            <div className="tile-ico">
              <Icon name={e.icon} size={21} />
            </div>
            <div className="tile-body">
              <div className="tile-title">{e.label}</div>
              <div className="tile-meta">{e.sub}</div>
            </div>
            <span className="tile-chev"><Icon name="chev" size={18} /></span>
          </button>
        ))}
        {viewOnly && (
          <div
            className="line-sub"
            style={{ textAlign: 'center', marginTop: 16, color: 'var(--c-text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Icon name="eye" size={13} /> Создание документов — у менеджера
          </div>
        )}
      </div>
    </div>
  )
}
