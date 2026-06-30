import { useSyncExternalStore } from 'react'
import { getApiBusy, subscribeApiBusy } from '../../api/http'

/** Тонкая полоса прогресса вверху экрана, пока выполняется хотя бы один write-запрос
 *  (создание/команда). Источник состояния — счётчик активности в http.ts. */
export function GlobalBusyBar() {
  const busy = useSyncExternalStore(subscribeApiBusy, getApiBusy, getApiBusy)
  return <div className={`global-busy-bar${busy ? ' active' : ''}`} role="progressbar" aria-hidden={!busy} />
}
