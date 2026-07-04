import { useEffect } from 'react'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { registerPushToken } from '../api/pushApi'
import { useNav } from '../nav/NavContext'
import { rememberPushToken } from './pushToken'

/** Регистрация устройства в FCM после входа + открытие экрана задачи по тапу на пуш.
 *  Монтируется внутри NavProvider (нужна навигация), рендерит ничего. */
export function PushBridge() {
  const { openTrip, openShipment, openDispatchPrepare, openPackDoc, openReceiptDoc } = useNav()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    const subs: PluginListenerHandle[] = []

    // Маппинг «задача → экран» — тот же, что у плиток в TasksScreen.
    const openTaskTarget = (data: Record<string, string>) => {
      const id = data.doc_id
      if (!id) return
      if (data.doc_type === 'trip') openTrip(id)
      else if (data.kind === 'shipment_pack') openPackDoc(id)
      else if (data.doc_type === 'shipment') openShipment(id)
      else if (data.doc_type === 'dispatch') openDispatchPrepare(id)
      else if (data.doc_type === 'receipt') openReceiptDoc(id)
    }

    ;(async () => {
      subs.push(
        await PushNotifications.addListener('registration', (t) => {
          rememberPushToken(t.value)
          registerPushToken(t.value, Capacitor.getPlatform()).catch(() => {})
        }),
        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          openTaskTarget((action.notification.data ?? {}) as Record<string, string>)
        }),
      )
      let perm = await PushNotifications.checkPermissions()
      if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions()
      if (perm.receive === 'granted' && !cancelled) await PushNotifications.register()
    })().catch(() => {
      // Нет google-services.json / пользователь запретил уведомления — приложение
      // работает как раньше, просто без пушей.
    })

    return () => {
      cancelled = true
      subs.forEach((s) => { s.remove().catch(() => {}) })
    }
    // Колбэки навигации пересоздаются на каждый рендер — перерегистрация слушателей
    // по ним дёргала бы натив; берём их один раз на монтирование.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
