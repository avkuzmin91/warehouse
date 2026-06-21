import { AuthProvider, useAuth } from './auth/AuthContext'
import { NavProvider, useNav } from './nav/NavContext'
import { BottomNav } from './components/BottomNav'
import { LoginScreen } from './screens/LoginScreen'
import { TasksScreen } from './screens/TasksScreen'
import { TripsListScreen } from './screens/TripsListScreen'
import { ShipmentsListScreen } from './screens/ShipmentsListScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { ScanScreen } from './screens/ScanScreen'
import { ScanProductScreen } from './screens/ScanProductScreen'
import { StockScreen } from './screens/StockScreen'
import { TripDetailScreen } from './screens/TripDetailScreen'
import { ShipmentDetailScreen } from './screens/ShipmentDetailScreen'

// Нижняя навигация — только на «корневых» вкладках. На детальных экранах
// (рейс/отгрузка/профиль) есть своя кнопка «назад», а скан — полноэкранный,
// поэтому таб-бар там скрыт.
const NAV_ROUTES = new Set(['tasks', 'trips', 'shipments', 'stock'])

function Main() {
  const { route } = useNav()
  let screen
  switch (route.name) {
    case 'tasks':     screen = <TasksScreen />; break
    case 'trips':     screen = <TripsListScreen />; break
    case 'shipments': screen = <ShipmentsListScreen />; break
    case 'profile':   screen = <ProfileScreen />; break
    case 'scan':      screen = <ScanScreen />; break
    case 'scanProduct': screen = <ScanProductScreen match={route.match} />; break
    case 'stock':     screen = <StockScreen />; break
    case 'trip':      screen = <TripDetailScreen tripId={route.id} />; break
    case 'shipment':  screen = <ShipmentDetailScreen shipmentId={route.id} />; break
  }
  return (
    <>
      {screen}
      {NAV_ROUTES.has(route.name) && <BottomNav />}
    </>
  )
}

function Gate() {
  const { ready, user } = useAuth()
  if (!ready) {
    return (
      <div className="screen">
        <div className="center">
          <div className="spin" />
          <div>Проверка сессии…</div>
        </div>
      </div>
    )
  }
  if (!user) return <LoginScreen />
  return (
    <NavProvider>
      <Main />
    </NavProvider>
  )
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
