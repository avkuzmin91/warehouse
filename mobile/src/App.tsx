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
import { ReceiptsListScreen } from './screens/manager/ReceiptsListScreen'
import { ReceiptFormScreen } from './screens/manager/ReceiptFormScreen'
import { PackingListScreen } from './screens/manager/PackingListScreen'
import { ShipmentFormScreen } from './screens/manager/ShipmentFormScreen'
import { DispatchListScreen } from './screens/manager/DispatchListScreen'
import { DispatchFormScreen } from './screens/manager/DispatchFormScreen'

function Main() {
  // Таб-бар — только на «корневых» вкладках (isTab). На детальных экранах есть своя
  // кнопка «назад», а скан — полноэкранный, поэтому таб-бар там скрыт.
  const { route, isTab } = useNav()
  let screen
  switch (route.name) {
    case 'tasks':     screen = <TasksScreen />; break
    case 'trips':     screen = <TripsListScreen />; break
    case 'shipments': screen = <ShipmentsListScreen />; break
    case 'mReceipts': screen = <ReceiptsListScreen />; break
    case 'receiptNew': screen = <ReceiptFormScreen />; break
    case 'mPacking':  screen = <PackingListScreen />; break
    case 'shipmentNew': screen = <ShipmentFormScreen />; break
    case 'mDispatch': screen = <DispatchListScreen />; break
    case 'dispatchNew': screen = <DispatchFormScreen />; break
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
      {isTab && <BottomNav />}
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
