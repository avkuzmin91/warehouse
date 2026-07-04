import { useEffect, useRef } from 'react'

// LIFO-реестр обработчиков аппаратной кнопки «Назад»: открытые оверлеи
// (шторки, пикеры, превью) регистрируются и перехватывают кнопку раньше,
// чем сработает навигация по стеку экранов.
type BackHandler = () => void

const stack: { current: BackHandler }[] = []

export function dispatchHardwareBack(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.current()
  return true
}

export function useHardwareBack(handler: BackHandler, active: boolean = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    stack.push(ref)
    return () => {
      const i = stack.lastIndexOf(ref)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
