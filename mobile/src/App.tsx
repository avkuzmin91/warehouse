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
import { ScanLocationScreen } from './screens/ScanLocationScreen'
import { StockScreen } from './screens/StockScreen'
import { TripDetailScreen } from './screens/TripDetailScreen'
import { ShipmentDetailScreen } from './screens/ShipmentDetailScreen'
import { ShiftPackingListScreen } from './screens/ShiftPackingListScreen'
import { ShiftPackingDetailScreen } from './screens/ShiftPackingDetailScreen'
import { ReceiptsListScreen } from './screens/manager/ReceiptsListScreen'
import { ReceiptFormScreen } from './screens/manager/ReceiptFormScreen'
import { ReceiptDetailScreen } from './screens/manager/ReceiptDetailScreen'
import { PackingListScreen } from './screens/manager/PackingListScreen'
import { ShipmentFormScreen } from './screens/manager/ShipmentFormScreen'
import { PackingDetailScreen } from './screens/manager/PackingDetailScreen'
import { DispatchListScreen } from './screens/manager/DispatchListScreen'
import { DispatchFormScreen } from './screens/manager/DispatchFormScreen'
import { DispatchDetailScreen } from './screens/manager/DispatchDetailScreen'
import { WarehouseHubScreen } from './screens/manager/WarehouseHubScreen'
import { ManagerTripsListScreen } from './screens/manager/ManagerTripsListScreen'
import { TripFormScreen } from './screens/manager/TripFormScreen'
import { ManagerTripDetailScreen } from './screens/manager/ManagerTripDetailScreen'

function Main() {
  // Таб-бар — только на «корневых» вкладках (isTab). На детальных экранах есть своя
  // кнопка «назад», а скан — полноэкранный, поэтому таб-бар там скрыт.
  const { route, isTab } = useNav()
  let screen
  switch (route.name) {
    case 'tasks':     screen = <TasksScreen />; break
    case 'trips':     screen = <TripsListScreen />; break
    case 'shipments': screen = <ShipmentsListScreen />; break
    case 'mTrips':    screen = <ManagerTripsListScreen />; break
    case 'tripNew':   screen = <TripFormScreen />; break
    case 'mTripDoc':  screen = <ManagerTripDetailScreen tripId={route.id} />; break
    case 'mWarehouse': screen = <WarehouseHubScreen />; break
    case 'mReceipts': screen = <ReceiptsListScreen />; break
    case 'receiptNew': screen = <ReceiptFormScreen />; break
    case 'mReceiptDoc': screen = <ReceiptDetailScreen docId={route.id} />; break
    case 'mPacking':  screen = <PackingListScreen />; break
    case 'shipmentNew': screen = <ShipmentFormScreen />; break
    case 'shipmentEdit': screen = <ShipmentFormScreen docId={route.id} />; break
    case 'mPackingDoc': screen = <PackingDetailScreen docId={route.id} />; break
    case 'mDispatch': screen = <DispatchListScreen />; break
    case 'dispatchNew': screen = <DispatchFormScreen />; break
    case 'dispatchEdit': screen = <DispatchFormScreen docId={route.id} />; break
    case 'mDispatchDoc': screen = <DispatchDetailScreen docId={route.id} />; break
    case 'profile':   screen = <ProfileScreen />; break
    case 'scan':      screen = <ScanScreen />; break
    case 'scanProduct': screen = <ScanProductScreen match={route.match} />; break
    case 'scanLocation': screen = <ScanLocationScreen location={route.location} />; break
    case 'stock':     screen = <StockScreen />; break
    case 'trip':      screen = <TripDetailScreen tripId={route.id} />; break
    case 'shipment':  screen = <ShipmentDetailScreen shipmentId={route.id} />; break
    case 'packing':   screen = <ShiftPackingListScreen />; break
    case 'packDoc':   screen = <ShiftPackingDetailScreen shipmentId={route.id} />; break
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
