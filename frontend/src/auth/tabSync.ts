/** Имя канала для синхронизации выхода между вкладками (PR7). */
export const WMS_AUTH_BROADCAST = 'wms-auth-session'

export function broadcastAuthLogout(): void {
  if (typeof BroadcastChannel === 'undefined') {
    return
  }
  try {
    const bc = new BroadcastChannel(WMS_AUTH_BROADCAST)
    bc.postMessage({ type: 'logout' as const })
    bc.close()
  } catch {
    /* ignore */
  }
}
