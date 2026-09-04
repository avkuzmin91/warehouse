import { AuthProvider, useAuth } from './auth/AuthContext'
import { NavProvider, useNav } from './nav/NavContext'
import { HardwareBack } from './nav/HardwareBack'
import { PushBridge } from './push/PushBridge'
import { BottomNav } from './components/BottomNav'
import { OfflineBanner } from './components/OfflineBanner'
import { ToastProvider } from './components/Toast'
import { LoginScreen } from './screens/LoginScreen'
import { TasksScreen } from './screens/TasksScreen'
import { TripsListScreen } from './screens/TripsListScreen'
import { ShipmentsListScreen } from './screens/ShipmentsListScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { ScanScreen } from './screens/ScanScreen'
import { ScanProductScreen } from './screens/ScanProductScreen'
import { ScanLocationScreen } from './screens/ScanLocationScreen'
import { ScanCisScreen } from './screens/ScanCisScreen'
import { StockScreen } from './screens/StockScreen'
import { TripDetailScreen } from './screens/TripDetailScreen'
import { ShipmentDetailScreen } from './screens/ShipmentDetailScreen'
import { DispatchPrepareScreen } from './screens/DispatchPrepareScreen'
import { ShiftPackingListScreen } from './screens/ShiftPackingListScreen'
import { ShiftPackingDetailScreen } from './screens/ShiftPackingDetailScreen'
import { PutawayTaskScreen } from './screens/PutawayTaskScreen'
import { PickQueueScreen } from './screens/PickQueueScreen'
import { SupplyPickScreen } from './screens/SupplyPickScreen'
import { PlaceScreen } from './screens/PlaceScreen'
import { ScanBoxScreen } from './screens/ScanBoxScreen'
import { PutawayBoxScreen } from './screens/PutawayBoxScreen'
import { PutawayAsideScreen } from './screens/PutawayAsideScreen'
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
import { ProductFormScreen } from './screens/manager/ProductFormScreen'
import { ProductEditScreen } from './screens/manager/ProductEditScreen'
import { ProductsCatalogScreen } from './screens/manager/ProductsCatalogScreen'
import { DictCatalogScreen } from './screens/manager/DictCatalogScreen'
import { ManagerTripsListScreen } from './screens/manager/ManagerTripsListScreen'
import { TripFormScreen } from './screens/manager/TripFormScreen'
import { ManagerTripDetailScreen } from './screens/manager/ManagerTripDetailScreen'
import { InvoicesListScreen } from './screens/manager/InvoicesListScreen'
import { InvoiceDetailScreen } from './screens/manager/InvoiceDetailScreen'
import { UninvoicedScreen } from './screens/manager/UninvoicedScreen'
import { ExtraIncomeScreen } from './screens/manager/ExtraIncomeScreen'
import { ExpensesScreen } from './screens/manager/ExpensesScreen'
import { ExpenseDetailScreen } from './screens/manager/ExpenseDetailScreen'
import { PackingProductivityScreen } from './screens/manager/PackingProductivityScreen'

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
    case 'productNew': screen = <ProductFormScreen />; break
    case 'productEdit': screen = <ProductEditScreen productId={route.id} />; break
    case 'mProducts': screen = <ProductsCatalogScreen />; break
    case 'mColors':   screen = <DictCatalogScreen kind="colors" />; break
    case 'mSizes':    screen = <DictCatalogScreen kind="sizes" />; break
    case 'mClients':  screen = <DictCatalogScreen kind="clients" />; break
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
    case 'mInvoices': screen = <InvoicesListScreen />; break
    case 'mInvoiceDoc': screen = <InvoiceDetailScreen invoiceId={route.id} />; break
    case 'mUninvoiced': screen = <UninvoicedScreen />; break
    case 'mExtraIncome': screen = <ExtraIncomeScreen />; break
    case 'mExpenses': screen = <ExpensesScreen />; break
    case 'mExpenseDoc': screen = <ExpenseDetailScreen expenseId={route.id} />; break
    case 'mPackingProductivity': screen = <PackingProductivityScreen />; break
    case 'profile':   screen = <ProfileScreen />; break
    case 'scan':      screen = <ScanScreen />; break
    case 'scanProduct': screen = <ScanProductScreen match={route.match} />; break
    case 'scanLocation': screen = <ScanLocationScreen location={route.location} />; break
    case 'scanCis':   screen = <ScanCisScreen cis={route.cis} />; break
    case 'stock':     screen = <StockScreen />; break
    case 'trip':      screen = <TripDetailScreen tripId={route.id} />; break
    case 'shipment':  screen = <ShipmentDetailScreen shipmentId={route.id} />; break
    case 'dispatchPrepare': screen = <DispatchPrepareScreen docId={route.id} />; break
    case 'packing':   screen = <ShiftPackingListScreen />; break
    case 'packDoc':   screen = <ShiftPackingDetailScreen shipmentId={route.id} focus={route.focus} />; break
    case 'putawayDoc': screen = <PutawayTaskScreen shipmentId={route.id} />; break
    case 'pick':      screen = <PickQueueScreen />; break
    case 'supplyPick': screen = <SupplyPickScreen supplyId={route.id} />; break
    case 'putawayBox': screen = <PutawayBoxScreen shipmentId={route.id} boxId={route.boxId} />; break
    case 'putawayAside': screen = <PutawayAsideScreen shipmentId={route.id} />; break
    case 'place': screen = <PlaceScreen source={route.source} />; break
    case 'scanBox': screen = <ScanBoxScreen containerId={route.containerId} />; break
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
      <HardwareBack />
      <PushBridge />
      <Main />
    </NavProvider>
  )
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <OfflineBanner />
        <Gate />
      </ToastProvider>
    </AuthProvider>
  )
}
