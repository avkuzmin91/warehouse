import { AppBar } from '../../components/AppBar'
import { Icon } from '../../components/Icon'

// Рейсы для менеджера пока заглушка: раздел в разработке. Складские роли
// работают с рейсами через свою вкладку (TripsListScreen).
export function ManagerTripsScreen() {
  return (
    <div className="screen">
      <AppBar title="Рейсы" sub="Раздел в разработке" />
      <div className="scroll pad-nav">
        <div className="center">
          <div className="center-ico">
            <Icon name="truck" size={26} />
          </div>
          <div>Раздел в разработке</div>
        </div>
      </div>
    </div>
  )
}
