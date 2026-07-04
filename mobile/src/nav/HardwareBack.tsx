import { useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { IS_NATIVE } from '../api/constants'
import { dispatchHardwareBack } from './backHandlers'
import { useNav } from './NavContext'

// Аппаратная кнопка «Назад» (Android): сначала закрывает верхний оверлей,
// затем снимает экран со стека (как кнопка в шапке), на корневой вкладке —
// сворачивает приложение.
export function HardwareBack() {
  const nav = useNav()
  const navRef = useRef(nav)
  navRef.current = nav

  useEffect(() => {
    if (!IS_NATIVE) return
    const sub = CapApp.addListener('backButton', () => {
      if (dispatchHardwareBack()) return
      if (navRef.current.isTab) void CapApp.minimizeApp()
      else navRef.current.back()
    })
    return () => {
      void sub.then((s) => s.remove())
    }
  }, [])

  return null
}
