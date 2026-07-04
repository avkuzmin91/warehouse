// Настройка «автозапуск камеры при открытии экрана скана». Persist в localStorage,
// по умолчанию включена; тумблер — на экране профиля.
const AUTO_SCAN_KEY = 'wms_scan_autostart'

export function isScanAutoStartEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_SCAN_KEY) !== '0'
  } catch {
    return true
  }
}

export function setScanAutoStartEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SCAN_KEY, enabled ? '1' : '0')
  } catch {
    // приватный режим / отключённое хранилище — настройка просто не сохранится
  }
}
