import { authEntryHref } from '../utils/routerBase'

let redirectScheduled = false

/**
 * Один редирект на страницу входа при истёкшей сессии (защита от гонок при множественных 401).
 * Полная перезагрузка — сбрасывает состояние React без дублирования логики в компонентах.
 */
export function scheduleHardRedirectToAuth(): boolean {
  if (redirectScheduled || typeof window === 'undefined') {
    return false
  }
  redirectScheduled = true
  window.location.replace(authEntryHref())
  return true
}
