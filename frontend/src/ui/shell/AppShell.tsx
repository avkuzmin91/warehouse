import { useState, useCallback, useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { useCurrentUser } from '../../hooks/useCurrentUser'

export function AppShell() {
  const { user } = useCurrentUser()
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

  return (
    <div className={`app-root${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar user={user} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <main className="main">
        <Topbar onCmd={openCmd} onToggleSidebar={toggleSidebar} sidebarCollapsed={sidebarCollapsed} />
        <div className="content">
          <Outlet />
        </div>
      </main>
      <CommandPalette open={cmdOpen} onClose={closeCmd} />
    </div>
  )
}
