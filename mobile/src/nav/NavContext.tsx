import { createContext, useContext, useState, type ReactNode } from 'react'
import type { BarcodeMatch } from '../api/productsApi'

export type TabName = 'tasks' | 'trips' | 'shipments' | 'stock'

export type Route =
  | { name: 'tasks' }
  | { name: 'trips' }
  | { name: 'shipments' }
  | { name: 'stock' }
  | { name: 'scan' }
  | { name: 'profile' }
  | { name: 'trip'; id: string }
  | { name: 'shipment'; id: string }
  | { name: 'scanProduct'; match: BarcodeMatch }

const TABS: TabName[] = ['tasks', 'trips', 'shipments', 'stock']

type NavState = {
  route: Route
  rootTab: TabName
  isTab: boolean
  goTab: (t: TabName) => void
  openTrip: (id: string) => void
  openShipment: (id: string) => void
  openScan: () => void
  openScanProduct: (match: BarcodeMatch) => void
  openProfile: () => void
  back: () => void
}

const NavCtx = createContext<NavState | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  // Стек маршрутов: дно стека всегда корневая вкладка, поверх — детальные экраны.
  const [stack, setStack] = useState<Route[]>([{ name: 'tasks' }])
  const route = stack[stack.length - 1]
  const bottom = stack[0]
  const rootTab: TabName = (TABS as string[]).includes(bottom.name) ? (bottom.name as TabName) : 'tasks'

  const value: NavState = {
    route,
    rootTab,
    isTab: (TABS as string[]).includes(route.name),
    goTab: (t) => setStack([{ name: t }]),
    openTrip: (id) => setStack((s) => [...s, { name: 'trip', id }]),
    openShipment: (id) => setStack((s) => [...s, { name: 'shipment', id }]),
    openScan: () => setStack((s) => [...s, { name: 'scan' }]),
    openScanProduct: (match) => setStack((s) => [...s, { name: 'scanProduct', match }]),
    openProfile: () => setStack((s) => [...s, { name: 'profile' }]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
  }
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>
}

export function useNav(): NavState {
  const ctx = useContext(NavCtx)
  if (!ctx) throw new Error('useNav вне NavProvider')
  return ctx
}
