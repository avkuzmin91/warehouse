import { useNav } from '../../nav/NavContext'
import { AppBar } from '../../components/AppBar'
import { Icon, type IconName } from '../../components/Icon'

type HubEntry = { label: string; sub: string; icon: IconName; open: () => void }

export function WarehouseHubScreen() {
  const { openReceiptsList, openPackingList, openDispatchList } = useNav()

  const entries: HubEntry[] = [
    { label: 'Поступления', sub: 'Документы приёмки', icon: 'dolly', open: openReceiptsList },
    { label: 'Упаковка', sub: 'Задачи упаковки', icon: 'box', open: openPackingList },
    { label: 'Отгрузки', sub: 'Документы отгрузки', icon: 'forklift', open: openDispatchList },
  ]

  return (
    <div className="screen">
      <AppBar title="Склад" sub="Документы" />
      <div className="scroll pad-nav">
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
      </div>
    </div>
  )
}
