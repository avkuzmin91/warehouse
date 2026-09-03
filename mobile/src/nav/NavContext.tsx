import { createContext, useContext, useState, type ReactNode } from 'react'
import type { BarcodeMatch } from '../api/productsApi'
import type { LocationMatch } from '../api/locationsApi'
import type { CisCode } from '../utils/cis'
import { useAuth } from '../auth/AuthContext'
import { tabsForRole, showScanForRole, type TabDef, type TabName } from './tabs'

export type { TabName } from './tabs'

// Позиция, к которой нужно проскроллить карточку упаковки (переход со скана:
// отсканированный вариант → его строка в задаче).
export type PackFocus = { productId: string; colorId: string | null; sizeId: string | null }

export type Route =
  | { name: 'tasks' }
  | { name: 'trips' }
  | { name: 'shipments' }
  | { name: 'stock' }
  | { name: 'packing' }
  | { name: 'packDoc'; id: string; focus?: PackFocus }
  | { name: 'putawayDoc'; id: string }
  | { name: 'putawayBox'; id: string; boxId: string }
  | { name: 'place' }
  | { name: 'scanBox'; containerId: string }
  | { name: 'mTrips' }
  | { name: 'mWarehouse' }
  | { name: 'mReceipts' }
  | { name: 'mPacking' }
  | { name: 'mDispatch' }
  | { name: 'scan' }
  | { name: 'profile' }
  | { name: 'trip'; id: string }
  | { name: 'shipment'; id: string }
  | { name: 'dispatchPrepare'; id: string }
  | { name: 'scanProduct'; match: BarcodeMatch }
  | { name: 'scanLocation'; location: LocationMatch }
  | { name: 'scanCis'; cis: CisCode }
  | { name: 'receiptNew' }
  | { name: 'shipmentNew' }
  | { name: 'shipmentEdit'; id: string }
  | { name: 'dispatchNew' }
  | { name: 'dispatchEdit'; id: string }
  | { name: 'tripNew' }
  | { name: 'productNew' }
  | { name: 'productEdit'; id: string }
  | { name: 'mProducts' }
  | { name: 'mColors' }
  | { name: 'mSizes' }
  | { name: 'mClients' }
  | { name: 'mReceiptDoc'; id: string }
  | { name: 'mPackingDoc'; id: string }
  | { name: 'mDispatchDoc'; id: string }
  | { name: 'mTripDoc'; id: string }
  | { name: 'mInvoices' }
  | { name: 'mInvoiceDoc'; id: string }
  | { name: 'mUninvoiced' }
  | { name: 'mExtraIncome' }
  | { name: 'mExpenses' }
  | { name: 'mExpenseDoc'; id: string }
  | { name: 'mPackingProductivity' }

type NavState = {
  route: Route
  rootTab: TabName
  isTab: boolean
  tabs: TabDef[]
  showScan: boolean
  goTab: (t: TabName) => void
  openTrip: (id: string) => void
  openShipment: (id: string) => void
  openDispatchPrepare: (id: string) => void
  openPackDoc: (id: string, focus?: PackFocus) => void
  openPutawayDoc: (id: string) => void
  openPutawayBox: (id: string, boxId: string) => void
  openPlace: () => void
  openScanBox: (containerId: string) => void
  openScan: () => void
  openScanProduct: (match: BarcodeMatch) => void
  openScanLocation: (location: LocationMatch) => void
  openScanCis: (cis: CisCode) => void
  openProfile: () => void
  openReceiptsList: () => void
  openPackingList: () => void
  openShiftPacking: () => void
  openDispatchList: () => void
  openReceiptNew: () => void
  openShipmentNew: () => void
  openPackingEdit: (id: string) => void
  openDispatchNew: () => void
  openDispatchEdit: (id: string) => void
  openTripNew: () => void
  openProductNew: () => void
  openProductEdit: (id: string) => void
  openProductsList: () => void
  openColorsList: () => void
  openSizesList: () => void
  openClientsList: () => void
  openReceiptDoc: (id: string) => void
  openPackingDoc: (id: string) => void
  openDispatchDoc: (id: string) => void
  openManagerTrip: (id: string) => void
  openInvoicesList: () => void
  openInvoiceDoc: (id: string) => void
  openUninvoiced: () => void
  openExtraIncome: () => void
  openExpensesList: () => void
  openExpenseDoc: (id: string) => void
  openPackingProductivity: () => void
  back: () => void
}

const NavCtx = createContext<NavState | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const role = user?.role ?? ''
  const tabs = tabsForRole(role)
  const showScan = showScanForRole(role)
  const tabNames = tabs.map((t) => t.name) as string[]
  const homeTab = tabs[0].name

  // Стек маршрутов: дно стека всегда корневая вкладка, поверх — детальные экраны.
  const [stack, setStack] = useState<Route[]>([{ name: homeTab }])
  const route = stack[stack.length - 1]
  const bottom = stack[0]
  const rootTab: TabName = tabNames.includes(bottom.name) ? (bottom.name as TabName) : homeTab

  const value: NavState = {
    route,
    rootTab,
    isTab: tabNames.includes(route.name),
    tabs,
    showScan,
    goTab: (t) => setStack([{ name: t }]),
    openTrip: (id) => setStack((s) => [...s, { name: 'trip', id }]),
    openShipment: (id) => setStack((s) => [...s, { name: 'shipment', id }]),
    openDispatchPrepare: (id) => setStack((s) => [...s, { name: 'dispatchPrepare', id }]),
    openPackDoc: (id, focus) => setStack((s) => [...s, { name: 'packDoc', id, focus }]),
    openPutawayDoc: (id) => setStack((s) => [...s, { name: 'putawayDoc', id }]),
    openPutawayBox: (id, boxId) => setStack((s) => [...s, { name: 'putawayBox', id, boxId }]),
    openPlace: () => setStack((s) => [...s, { name: 'place' }]),
    openScanBox: (containerId) => setStack((s) => [...s, { name: 'scanBox', containerId }]),
    openScan: () => setStack((s) => [...s, { name: 'scan' }]),
    openScanProduct: (match) => setStack((s) => [...s, { name: 'scanProduct', match }]),
    openScanLocation: (location) => setStack((s) => [...s, { name: 'scanLocation', location }]),
    openScanCis: (cis) => setStack((s) => [...s, { name: 'scanCis', cis }]),
    openProfile: () => setStack((s) => [...s, { name: 'profile' }]),
    openReceiptsList: () => setStack((s) => [...s, { name: 'mReceipts' }]),
    openPackingList: () => setStack((s) => [...s, { name: 'mPacking' }]),
    openShiftPacking: () => setStack((s) => [...s, { name: 'packing' }]),
    openDispatchList: () => setStack((s) => [...s, { name: 'mDispatch' }]),
    openReceiptNew: () => setStack((s) => [...s, { name: 'receiptNew' }]),
    openShipmentNew: () => setStack((s) => [...s, { name: 'shipmentNew' }]),
    openPackingEdit: (id) => setStack((s) => [...s, { name: 'shipmentEdit', id }]),
    openDispatchNew: () => setStack((s) => [...s, { name: 'dispatchNew' }]),
    openDispatchEdit: (id) => setStack((s) => [...s, { name: 'dispatchEdit', id }]),
    openTripNew: () => setStack((s) => [...s, { name: 'tripNew' }]),
    openProductNew: () => setStack((s) => [...s, { name: 'productNew' }]),
    openProductEdit: (id) => setStack((s) => [...s, { name: 'productEdit', id }]),
    openProductsList: () => setStack((s) => [...s, { name: 'mProducts' }]),
    openColorsList: () => setStack((s) => [...s, { name: 'mColors' }]),
    openSizesList: () => setStack((s) => [...s, { name: 'mSizes' }]),
    openClientsList: () => setStack((s) => [...s, { name: 'mClients' }]),
    openReceiptDoc: (id) => setStack((s) => [...s, { name: 'mReceiptDoc', id }]),
    openPackingDoc: (id) => setStack((s) => [...s, { name: 'mPackingDoc', id }]),
    openDispatchDoc: (id) => setStack((s) => [...s, { name: 'mDispatchDoc', id }]),
    openManagerTrip: (id) => setStack((s) => [...s, { name: 'mTripDoc', id }]),
    openInvoicesList: () => setStack((s) => [...s, { name: 'mInvoices' }]),
    openInvoiceDoc: (id) => setStack((s) => [...s, { name: 'mInvoiceDoc', id }]),
    openUninvoiced: () => setStack((s) => [...s, { name: 'mUninvoiced' }]),
    openExtraIncome: () => setStack((s) => [...s, { name: 'mExtraIncome' }]),
    openExpensesList: () => setStack((s) => [...s, { name: 'mExpenses' }]),
    openExpenseDoc: (id) => setStack((s) => [...s, { name: 'mExpenseDoc', id }]),
    openPackingProductivity: () => setStack((s) => [...s, { name: 'mPackingProductivity' }]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
  }
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>
}

export function useNav(): NavState {
  const ctx = useContext(NavCtx)
  if (!ctx) throw new Error('useNav вне NavProvider')
  return ctx
}
