import { useState, useCallback, useEffect, Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { PendingAccessPage } from '../pages/PendingAccessPage'

export function AppShell() {
  const { user, loading } = useCurrentUser()
  const [cmdOpen, setCmdOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const openCmd = useCallback(() => setCmdOpen(true), [])
  const closeCmd = useCallback(() => setCmdOpen(false), [])
  const toggleSidebar = useCallback(() => setSidebarCollapsed((v) => !v), [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen((s) => !s)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', color: 'var(--c-text-muted)', fontSize: 13 }}>
        Проверка доступа...
      </div>
    )
  }

  if (user?.role === 'user') {
    return <PendingAccessPage email={user.email} />
  }

  return (
    <div className={`app-root${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <main className="main">
        <Topbar onCmd={openCmd} onToggleSidebar={toggleSidebar} sidebarCollapsed={sidebarCollapsed} />
        <div className="content">
          <Suspense>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <CommandPalette open={cmdOpen} onClose={closeCmd} />
    </div>
  )
}
